"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRenderer } from "@/components/elios/renderer";
import type { LeaderboardRow } from "@/lib/elios-leaderboard";
import {
  flushPendingScore,
  readPendingScore,
  subscribePendingScore,
  submitEliosScore,
} from "@/lib/elios-score-sync";
import {
  BEST_SCORE_KEY,
  FLIGHT_MODES,
  KIND_LABELS,
  METRES_PER_UNIT,
  MODE_SPECS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  ZONE_NAMES,
  createGame,
  crashLine,
  flap,
  isNewBest,
  nudgeThrottle,
  parseStoredBest,
  setMode,
  stepGame,
  type FlightMode,
  type GameState,
  type Impact,
} from "@/lib/elios-flight";

/**
 * "Fly where people can't" — the Elios 3 flies through the confined spaces it
 * really inspects, a boiler, a ballast tank, a mine stope, a sewer and a
 * storage tank, past what a pilot meets in each of them.
 *
 * This file is input, the frame loop and the chrome around the canvas. The
 * rules live in `lib/elios-flight.ts` and are unit-tested; the look — real
 * Flyability photographs, the drone as the only light — lives in
 * `components/elios/`. The game itself stays inert: the only network it
 * touches is the leaderboard, and only when a caller opts in.
 *
 * A run flown without a connection still counts: its score waits in
 * localStorage (`lib/elios-score-sync.ts`) and is posted the moment the
 * browser is back online.
 */

/**
 * Flight-modes preview: scores flown under the new rules are kept off the live
 * board until the release that resets it. Flip this with that release.
 */
const POST_SCORES = false;

/** Where the player left the mode switch, so the next visit starts there. */
const MODE_KEY = "rolegate:elios-mode";

const DEFAULT_MODE: FlightMode = "ASSIST_SPORT";

/** Read through `useSyncExternalStore`, the same way and for the same reasons as the best score below. */
let modeCache: FlightMode | undefined;
const modeListeners = new Set<() => void>();

function readMode(): FlightMode {
  if (modeCache === undefined) {
    modeCache = DEFAULT_MODE;
    try {
      const raw = window.localStorage.getItem(MODE_KEY);
      if (raw && (FLIGHT_MODES as readonly string[]).includes(raw)) modeCache = raw as FlightMode;
    } catch {
      // Private windows: start in the default.
    }
  }
  return modeCache;
}

function writeMode(mode: FlightMode) {
  modeCache = mode;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // A nicety.
  }
  for (const listener of modeListeners) listener();
}

function subscribeMode(onChange: () => void) {
  modeListeners.add(onChange);
  return () => {
    modeListeners.delete(onChange);
  };
}

/** What the pilot is holding right now; read by the frame loop every step. */
type Held = { climb: boolean; descend: boolean; slower: boolean; faster: boolean };
const NOTHING_HELD: Held = { climb: false, descend: false, slower: false, faster: false };

/**
 * Keys. ↑/W/Space/Enter climb (a flap in ATTI MAN), ↓/S descend, ←/→ (A/D)
 * move the throttle; 1–5 pick a mode and M steps through them.
 */
function heldKeyFor(key: string): keyof Held | null {
  if (key === " " || key === "Enter" || key === "ArrowUp" || key === "w" || key === "W") return "climb";
  if (key === "ArrowDown" || key === "s" || key === "S") return "descend";
  if (key === "ArrowLeft" || key === "a" || key === "A") return "slower";
  if (key === "ArrowRight" || key === "d" || key === "D") return "faster";
  return null;
}

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

type Hud = { status: GameState["status"]; score: number; impact: Impact | null; zone: number };

export function EliosGame({ className = "mt-4", leaderboard = false, paused = false }: EliosGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGame());
  // Server render has no localStorage, so the server snapshot is always null.
  const best = useSyncExternalStore(subscribeBest, readBest, () => null);
  const [hud, setHud] = useState<Hud>({ status: "idle", score: 0, impact: null, zone: 0 });
  const mode = useSyncExternalStore(subscribeMode, readMode, () => DEFAULT_MODE);
  const heldRef = useRef<Held>(NOTHING_HELD);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const pending = useSyncExternalStore(subscribePendingScore, readPendingScore, () => null);

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
    if (!leaderboard) return;
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
  }, [leaderboard]);

  // The first space is drawn here rather than during render: the server has
  // to render the same markup the client hydrates, so nothing random may
  // happen before mount. Only the canvas shows it, and the canvas is empty
  // until then anyway.
  useEffect(() => {
    const s = stateRef.current;
    if (s.status === "idle" && s.obstacles.length === 0) {
      stateRef.current = createGame(Math.floor(Math.random() * ZONES.length), readMode());
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

  // Coming back online: post whatever was flown while away, then refresh the
  // board — which may well have failed to load in the first place.
  useEffect(() => {
    if (!leaderboard) return;
    const sync = () => {
      void flushPendingScore().then(() => loadBoard());
    };
    if (readPendingScore() !== null) sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [leaderboard, loadBoard]);

  /** A press: launches, relaunches after a run, and flaps in ATTI MAN. */
  const press = useCallback(() => {
    if (paused) return;
    const s = stateRef.current;
    const over = s.status === "crashed" || s.status === "landed";
    stateRef.current = over ? flap(createGame(nextZone(s.droneZone), s.mode)) : flap(s);
    const n = stateRef.current;
    setHud({ status: n.status, score: n.score, impact: null, zone: n.droneZone });
  }, [paused]);

  const chooseMode = useCallback((next: FlightMode) => {
    stateRef.current = setMode(stateRef.current, next);
    writeMode(next);
  }, []);

  /** A held input; a fresh press of the throttle also steps it, so a tap does something. */
  const hold = useCallback((key: keyof Held, on: boolean) => {
    if (on && !heldRef.current[key] && (key === "slower" || key === "faster")) {
      stateRef.current = nudgeThrottle(stateRef.current, key === "faster" ? 1 : -1);
    }
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
      const resting =
        stateRef.current.status === "idle" ||
        ((stateRef.current.status === "crashed" || stateRef.current.status === "landed") &&
          now - crashedAt > CRASH_SETTLE_MS);
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
        climb: held.climb,
        descend: held.descend,
        throttle: held.faster === held.slower ? 0 : held.faster ? 1 : -1,
      });
      stateRef.current = after;

      if (before.status === "flying" && (after.status === "crashed" || after.status === "landed")) {
        crashedAt = now;
        if (isNewBest(after.score, readBest())) writeBest(after.score);
        if (POST_SCORES && leaderboard && after.score > 0) void submitScoreRef.current(after.score);
        setHud({ status: after.status, score: after.score, impact: after.impact, zone: after.droneZone });
      } else if (after.score !== before.score) {
        setHud({ status: after.status, score: after.score, impact: null, zone: after.droneZone });
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
      const n = Number(e.key);
      if (e.key !== " " && Number.isInteger(n) && n >= 1 && n <= FLIGHT_MODES.length) {
        e.preventDefault();
        chooseMode(FLIGHT_MODES[n - 1]);
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        const i = FLIGHT_MODES.indexOf(stateRef.current.mode);
        chooseMode(FLIGHT_MODES[(i + 1) % FLIGHT_MODES.length]);
        return;
      }
      const key = heldKeyFor(e.key);
      if (!key) return;
      e.preventDefault();
      if (!e.repeat && (key === "climb" || (key === "descend" && stateRef.current.status !== "flying"))) press();
      hold(key, true);
    },
    [press, hold, chooseMode],
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
      press();
      hold(lower ? "descend" : "climb", true);
    },
    [press, hold],
  );

  const release = useCallback(() => {
    hold("climb", false);
    hold("descend", false);
  }, [hold]);

  const where = ZONE_NAMES[ZONES[hud.zone]]?.name.toLowerCase();

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Fly where people can't: fly the Elios 3 through real confined spaces. Space or up to climb, down to descend, left and right for speed, 1 to 5 for the flight mode."
        onPointerDown={onPointerDown}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onBlur={() => {
          heldRef.current = NOTHING_HELD;
        }}
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
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-black/25 to-transparent px-4 pb-[7%] text-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/90">
                Fly where people can&rsquo;t
              </p>
              {hud.status === "landed" ? (
                <p className="mt-1.5 text-sm font-medium text-white">
                  Battery flat — {hud.score} cleared in {MODE_SPECS[mode].label}
                </p>
              ) : hud.status === "crashed" ? (
                <>
                  <p className="mt-1.5 text-sm font-medium text-white">
                    {hud.score} cleared — {crashLine(hud.score)}
                  </p>
                  {hud.impact && where ? (
                    <p className="mt-0.5 text-[11px] text-white/65">
                      Hit {KIND_LABELS[hud.impact.what]} in the {where}.
                    </p>
                  ) : null}
                </>
              ) : null}
              <p className="mt-1.5 text-[11px] text-white/65">
                Tap or press space to {hud.status === "idle" ? "fly" : "go again"}
              </p>
              {hud.status === "idle" ? (
                <p className="mt-1 text-[10px] text-white/50">
                  {MODE_SPECS[mode].altitudeHold
                    ? "Hold top half / ↑ to climb, bottom half / ↓ to descend · ← → speed"
                    : "Tap / space to flap against gravity · ← → speed"}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {FLIGHT_MODES.map((option, i) => {
          const spec = MODE_SPECS[option];
          const on = mode === option;
          const limit = option === "ATTI_MAN" ? "unlimited" : `${(spec.maxSpeed * METRES_PER_UNIT).toFixed(1)} m/s max`;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              title={`${spec.holds} · ${limit} · key ${i + 1}`}
              onClick={() => chooseMode(option)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                on ? "border-accent/60 bg-accent/15 text-ink" : "border-glass/20 text-ink-4 hover:text-ink-2"
              }`}
            >
              {spec.label}
            </button>
          );
        })}
        <span className="ml-auto flex gap-1.5">
          {(["slower", "faster"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-label={key === "slower" ? "Slower" : "Faster"}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                hold(key, true);
              }}
              onPointerUp={() => hold(key, false)}
              onPointerCancel={() => hold(key, false)}
              onLostPointerCapture={() => hold(key, false)}
              className="size-8 touch-none select-none rounded-full border border-glass/20 text-sm text-ink-3 active:bg-accent/15"
            >
              {key === "slower" ? "−" : "+"}
            </button>
          ))}
        </span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        {best !== null || (leaderboard && pending !== null) ? (
          <p className="text-[11px] text-ink-5">
            {best !== null ? `Best ${best}` : null}
            {best !== null && leaderboard && pending !== null ? " · " : null}
            {leaderboard && pending !== null ? (
              <span className="text-ink-5/80">{pending} waiting to post to the board</span>
            ) : null}
          </p>
        ) : (
          <span />
        )}
        {leaderboard && board && board.length > 0 ? (
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
