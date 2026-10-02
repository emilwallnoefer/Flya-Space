"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRenderer } from "@/components/elios/renderer";
import { EVENT_KINDS } from "@/lib/elios-events";
import type { LeaderboardRow } from "@/lib/elios-leaderboard";
import {
  flushPendingScore,
  readPendingScore,
  subscribePendingScore,
  submitEliosScore,
} from "@/lib/elios-score-sync";
import {
  BEST_SCORE_KEY,
  KIND_LABELS,
  MODE_SPECS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  ZONE_MODE,
  ZONE_NAMES,
  createGame,
  crashLine,
  flap,
  isNewBest,
  parseStoredBest,
  stepGame,
  type GameState,
  type Impact,
} from "@/lib/elios-flight";

/**
 * "Fly where people can't" — the Elios 3 flies through the confined spaces it
 * really inspects, a boiler, a ballast tank, a mine stope, a sewer and a
 * storage tank, while the things that really go wrong in there go wrong.
 *
 * One control, the same all run: hold up or down to fly. The space decides
 * whether the aircraft holds itself steady (Assist) or drifts (ATTI), and dust
 * can force the drift on it — the controls never change meaning, only how
 * well the aircraft obeys them.
 *
 * This file is input, the frame loop and the chrome around the canvas. The
 * rules live in `lib/elios-flight.ts` and `lib/elios-events.ts` and are
 * unit-tested; the look lives in `components/elios/`. The game itself stays
 * inert: the only network it touches is the leaderboard, and only when a
 * caller opts in.
 */

/**
 * Preview: scores flown under the new rules are kept off the live board until
 * the release that resets it. Flip this with that release.
 */
const POST_SCORES = false;

/** What the pilot is holding right now; read by the frame loop every step. */
type Held = { climb: boolean; descend: boolean };
const NOTHING_HELD: Held = { climb: false, descend: false };

/** Frame rate while nothing is being flown: waiting for a press, or after a crash has settled. */
const RESTING_FPS = 24;
/** How long the crash dust gets at the full frame rate before the canvas rests. */
const CRASH_SETTLE_MS = 1500;

/**
 * The best score lives in localStorage, which is an external store, so it is
 * read through `useSyncExternalStore` rather than a state-set inside an effect.
 * That is not ceremony: setting state synchronously in a mount effect is what
 * the React Compiler rule `set-state-in-effect` rejects, and it also renders a
 * wrong value for one frame on every visit.
 *
 * `undefined` means "not read yet" — distinct from `null`, which is a real
 * answer meaning "no score stored".
 */
let bestCache: number | null | undefined;
const bestListeners = new Set<() => void>();

function readBest(): number | null {
  if (bestCache === undefined) {
    try {
      bestCache = parseStoredBest(window.localStorage.getItem(BEST_SCORE_KEY));
    } catch {
      // Private windows and blocked site data both throw here.
      bestCache = null;
    }
  }
  return bestCache;
}

function writeBest(score: number) {
  bestCache = score;
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    // Keeping the score is a nicety, not the point.
  }
  for (const listener of bestListeners) listener();
}

function subscribeBest(onChange: () => void) {
  bestListeners.add(onChange);
  return () => {
    bestListeners.delete(onChange);
  };
}

/** A different space from the last run's, so going again shows you somewhere new. */
function nextZone(previous: number): number {
  const n = ZONES.length;
  return (previous + 1 + Math.floor(Math.random() * (n - 1))) % n;
}

/**
 * A fresh run with events and pick-ups — the game as it is meant to be flown.
 * In development `?event=DARKNESS` (any kind) makes that event come first, a
 * few seconds in, so each one can be tried on demand.
 */
function newRun(zone: number): GameState {
  const run = createGame(zone, true);
  if (process.env.NODE_ENV === "production") return run;
  const asked = new URLSearchParams(window.location.search).get("event")?.toUpperCase();
  const kind = EVENT_KINDS.find((k) => k === asked);
  return kind ? { ...run, queued: kind, nextEventAt: 250 } : run;
}

/** Keys: ↑/W/Space/Enter climb, ↓/S descend. */
function heldKeyFor(key: string): keyof Held | null {
  if (key === " " || key === "Enter" || key === "ArrowUp" || key === "w" || key === "W") return "climb";
  if (key === "ArrowDown" || key === "s" || key === "S") return "descend";
  return null;
}

export type EliosGameProps = {
  /** Extra classes for the wrapper — the composer needs different spacing. */
  className?: string;
  /**
   * Show the workspace leaderboard under the game and post scores to it.
   * Off by default so a caller has to opt in to the network.
   */
  leaderboard?: boolean;
  /**
   * Stop the animation loop entirely.
   *
   * For a caller that fades the game out rather than unmounting it: an
   * invisible canvas repainting sixty times a second is pure waste, and the
   * game state lives in refs, so pausing and resuming picks up mid-flight.
   */
  paused?: boolean;
};

type Hud = {
  status: GameState["status"];
  score: number;
  impact: Impact | null;
  zone: number;
  /** "SIGNAL:lost" and the like — what the overlay buttons need to know. */
  event: string;
};

const eventKey = (s: GameState) => (s.event ? `${s.event.kind}:${s.event.phase}` : "");

function hudOf(s: GameState, impact: Impact | null = s.impact): Hud {
  return { status: s.status, score: s.score, impact, zone: s.droneZone, event: eventKey(s) };
}

export function EliosGame({ className = "mt-4", leaderboard = false, paused = false }: EliosGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGame(0));
  // Server render has no localStorage, so the server snapshot is always null.
  const best = useSyncExternalStore(subscribeBest, readBest, () => null);
  const [hud, setHud] = useState<Hud>(() => hudOf(createGame(0)));
  const heldRef = useRef<Held>(NOTHING_HELD);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const pending = useSyncExternalStore(subscribePendingScore, readPendingScore, () => null);
  const showBoard = POST_SCORES && leaderboard;

  /**
   * Refresh the board. Silent on failure: an unapplied migration or a dropped
   * connection must never break the game wrapped around it, and the board is
   * the least important thing on screen.
   */
  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/elios-score", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { board?: LeaderboardRow[] };
      setBoard(json.board ?? []);
    } catch {
      // Leave whatever was showing.
    }
  }, []);

  useEffect(() => {
    if (!showBoard) return;
    // Fetched inline with a cancel flag rather than by calling loadBoard():
    // the React Compiler treats an effect that calls a setState-bearing
    // callback as a synchronous set, and this shape also stops a late response
    // writing into an unmounted component.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/elios-score", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { board?: LeaderboardRow[] };
        if (!cancelled) setBoard(json.board ?? []);
      } catch {
        // The board is the least important thing on screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showBoard]);

  // The first space is drawn here rather than during render: the server has
  // to render the same markup the client hydrates, so nothing random may
  // happen before mount. Only the canvas shows it, and the canvas is empty
  // until then anyway.
  useEffect(() => {
    const s = stateRef.current;
    if (s.status === "idle" && s.obstacles.length === 0) {
      stateRef.current = newRun(Math.floor(Math.random() * ZONES.length));
    }
  }, []);

  /**
   * Post a finished run. The server decides whether it is an improvement;
   * without a connection the score is kept and posted later.
   */
  const submitScore = useCallback(
    async (score: number) => {
      if (await submitEliosScore(score)) await loadBoard();
    },
    [loadBoard],
  );

  // Coming back online: post whatever was flown while away, then refresh the board.
  useEffect(() => {
    if (!showBoard) return;
    const sync = () => {
      void flushPendingScore().then(() => loadBoard());
    };
    if (readPendingScore() !== null) sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [showBoard, loadBoard]);

  /** A press: launches, or starts a fresh run after one ends. */
  const press = useCallback(() => {
    if (paused) return;
    const s = stateRef.current;
    const over = s.status === "crashed";
    stateRef.current = over ? flap(newRun(nextZone(s.droneZone))) : flap(s);
    setHud(hudOf(stateRef.current, null));
  }, [paused]);


  const hold = useCallback((key: keyof Held, on: boolean) => {
    heldRef.current = { ...heldRef.current, [key]: on };
  }, []);

  // The frame loop is set up once and must not restart when a callback
  // identity changes — restarting it mid-flight would reset the canvas.
  const submitScoreRef = useRef(submitScore);
  useEffect(() => {
    submitScoreRef.current = submitScore;
  }, [submitScore]);

  useEffect(() => {
    if (paused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const renderer = createRenderer(canvas, { reducedMotion });
    if (!renderer) return;

    /**
     * Size the backing store to the space the canvas actually occupies.
     *
     * The drawing works in world units; only the transform changes, so
     * nothing downstream has to know the display size. Re-measured on
     * resize, because the composer column changes width when the layout
     * breaks to one column and when the window is dragged.
     */
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    /** Ceiling on the backing store, so a very wide card cannot allocate an absurd buffer. */
    const MAX_BACKING_WIDTH = 2400;
    let backingWidth = 0;

    const resize = () => {
      const cssWidth = canvas.clientWidth || WORLD_WIDTH;
      const next = Math.min(Math.round(cssWidth * dpr), MAX_BACKING_WIDTH);
      if (next === backingWidth) return;
      backingWidth = next;
      canvas.width = next;
      canvas.height = Math.round((next * WORLD_HEIGHT) / WORLD_WIDTH);
    };
    resize();

    // Resizing the canvas clears it, so a resize between frames would flash —
    // the loop repaints every frame, so it redraws before anything is shown.
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let stopped = false;
    let crashedAt = -Infinity;

    const frame = (now: number) => {
      if (stopped) return;

      // Waiting for a press is most of the game's life — the composer shows
      // it for as long as the form is open. The hover and the far-wall drift
      // read the same at a low rate, and drawing the lit canvas at the display
      // rate cost half a core doing nothing. A run, and the crash dust that
      // ends one, keep the full rate.
      const status = stateRef.current.status;
      const resting = status === "idle" || (status !== "flying" && now - crashedAt > CRASH_SETTLE_MS);
      if (resting && now - last < 1000 / RESTING_FPS) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const dt = (now - last) / 1000;
      last = now;

      const before = stateRef.current;
      const held = heldRef.current;
      const after = stepGame(before, {
        dt,
        kindDraw: Math.random(),
        placeDraw: Math.random(),
        styleDraw: Math.random(),
        eventDraw: Math.random(),
        climb: held.climb,
        descend: held.descend,
      });
      stateRef.current = after;

      if (before.status === "flying" && after.status !== "flying") {
        crashedAt = now;
        if (isNewBest(after.score, readBest())) writeBest(after.score);
        if (POST_SCORES && leaderboard && after.score > 0) void submitScoreRef.current(after.score);
        setHud(hudOf(after));
      } else if (after.score !== before.score || eventKey(after) !== eventKey(before)) {
        setHud(hudOf(after, null));
      }

      // The renderer's clock is capped separately: a tab coming back from
      // the background should not fling the dust across the screen.
      renderer.frame(after, Math.min(Math.max(dt, 0), 0.1), now / 1000);
      raf = requestAnimationFrame(frame);
    };

    // A hidden tab already stops animation frames; a canvas scrolled out of
    // view does not, so stop the loop while none of it is on screen. The clock
    // restarts on the way back, so a run picks up where it was left.
    const visibility = new IntersectionObserver(([entry]) => {
      if (stopped) return;
      cancelAnimationFrame(raf);
      raf = 0;
      if (entry?.isIntersecting) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    visibility.observe(canvas);

    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      visibility.disconnect();
      renderer.dispose();
    };
  }, [leaderboard, paused]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = heldKeyFor(e.key);
      if (!key) return;
      e.preventDefault();
      if (!e.repeat && stateRef.current.status !== "flying") press();
      hold(key, true);
    },
    [press, hold],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      const key = heldKeyFor(e.key);
      if (key) hold(key, false);
    },
    [hold],
  );

  /** Touch and mouse on the canvas: the upper half climbs, the lower half descends. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // preventDefault stops the tap selecting text or starting a drag — but
      // it also suppresses the focus that would normally follow, which left
      // Space doing nothing after a click. Focus explicitly instead.
      e.preventDefault();
      e.currentTarget.focus();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const box = e.currentTarget.getBoundingClientRect();
      const lower = e.clientY - box.top > box.height / 2;
      if (stateRef.current.status !== "flying") press();
      hold(lower ? "descend" : "climb", true);
    },
    [press, hold],
  );

  const release = useCallback(() => {
    heldRef.current = NOTHING_HELD;
  }, []);

  const where = ZONE_NAMES[ZONES[hud.zone]]?.name.toLowerCase();
  const mode = MODE_SPECS[ZONE_MODE[ZONES[hud.zone]]];

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Fly where people can't: fly the Elios 3 through real confined spaces. Hold up to climb, down to descend."
        onPointerDown={onPointerDown}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onBlur={release}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className="relative block w-full cursor-pointer overflow-hidden rounded-xl border border-glass/20 bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <canvas
          ref={canvasRef}
          className="block h-auto w-full touch-none select-none"
          style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}` }}
        />
        {hud.status !== "flying" ? (
          // The scene behind is always dark, whatever the app theme, so the
          // title card uses fixed light text rather than theme tokens. It
          // sits low, under the drone rather than over it.
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/85 via-black/30 to-transparent px-4 pb-[6%] text-center">
            <div className="max-w-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/90">
                Fly where people can&rsquo;t
              </p>
              {hud.status === "crashed" ? (
                <>
                  <p className="mt-1.5 text-sm font-medium text-white">
                    {hud.score} cleared — {crashLine(hud.score)}
                  </p>
                  {hud.impact && where ? (
                    <p className="mt-0.5 text-[11px] text-white/65">
                      {hud.impact.what === "RADIATION"
                        ? "E04 — dose limit reached. The flight is over."
                        : hud.impact.what === "GAS"
                          ? "PA08 — not out of the gas fast enough."
                          : hud.impact.what === "CABLE"
                            ? `Snagged ${KIND_LABELS.CABLE} in the ${where}.`
                            : `Hit ${KIND_LABELS[hud.impact.what]} in the ${where}.`}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1.5 text-[12px] leading-snug text-white/85">
                  Hold up / down to fly. Tight spaces fly in Assist; open voids and dust drop you to ATTI — it drifts. It gets faster.
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-white/65">
                Tap or press space to {hud.status === "idle" ? "fly" : "go again"}
              </p>
              {hud.status === "idle" ? (
                <p className="mt-0.5 text-[10px] text-white/45">
                  Grab ↻ for Repeat Flight, ✦ for the dust-proof light · this space: {mode.label}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        {best !== null || (showBoard && pending !== null) ? (
          <p className="text-[11px] text-ink-5">
            {best !== null ? `Best ${best}` : null}
            {best !== null && showBoard && pending !== null ? " · " : null}
            {showBoard && pending !== null ? (
              <span className="text-ink-5/80">{pending} waiting to post to the board</span>
            ) : null}
          </p>
        ) : (
          <span />
        )}
        {showBoard && board && board.length > 0 ? (
          <ol className="min-w-0 text-right text-[11px] leading-5 text-ink-4/80">
            {board.slice(0, 5).map((row, i) => (
              <li key={`${row.name}-${i}`} className={row.you ? "text-accent-soft/90" : undefined}>
                <span className="text-ink-5">{i + 1}.</span> {row.name}{" "}
                <span className="font-medium text-ink-3">{row.score}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
