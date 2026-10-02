"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRenderer } from "@/components/elios/renderer";
import type { LeaderboardRow } from "@/lib/elios-leaderboard";
import {
  flushPendingScore,
  readPendingScore,
  subscribePendingScore,
  submitEliosScore,
} from "@/lib/elios-score-sync";
import {
  FLIGHT_MODES,
  KIND_LABELS,
  METRES_PER_UNIT,
  MODE_SPECS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  ZONE_NAMES,
  allowedModes,
  batteryLeft,
  createMission,
  flap,
  nudgeThrottle,
  setMode,
  stepGame,
  type FlightMode,
  type GameState,
  type Impact,
} from "@/lib/elios-flight";
import {
  MISSIONS,
  buildPlan,
  isUnlocked,
  missionStars,
  nextMission,
  parseProgress,
  recordStars,
  type Progress,
} from "@/lib/elios-missions";

/**
 * "Fly where people can't" — the Elios 3 flies inspection missions through the
 * confined spaces it really works in: a boiler, a ballast tank, a mine stope,
 * a sewer and a storage tank.
 *
 * This file is input, the frame loop and the chrome around the canvas. The
 * rules live in `lib/elios-flight.ts`, the missions in `lib/elios-missions.ts`,
 * both unit-tested; the look — real Flyability photographs, the drone as the
 * only light — lives in `components/elios/`. The game itself stays inert: the
 * only network it touches is the leaderboard, and only when a caller opts in.
 */

/**
 * Missions preview: nothing flown under the new rules reaches the live board,
 * and the board is not shown, until the release that decides what it ranks.
 */
const POST_SCORES = false;

/** Best stars per mission. */
const PROGRESS_KEY = "rolegate:elios-missions-v1";

/**
 * Progress lives in localStorage, an external store, so it is read through
 * `useSyncExternalStore` rather than a state-set inside an effect: setting
 * state synchronously in a mount effect is what the React Compiler rule
 * `set-state-in-effect` rejects, and it would render a wrong value for a frame.
 */
let progressCache: Progress | undefined;
const progressListeners = new Set<() => void>();
const NO_PROGRESS: Progress = {};

function readProgress(): Progress {
  if (progressCache === undefined) {
    try {
      progressCache = parseProgress(window.localStorage.getItem(PROGRESS_KEY));
    } catch {
      // Private windows and blocked site data both throw here.
      progressCache = NO_PROGRESS;
    }
  }
  return progressCache;
}

function writeProgress(progress: Progress) {
  if (progress === progressCache) return;
  progressCache = progress;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Keeping progress is a nicety, not the point.
  }
  for (const listener of progressListeners) listener();
}

function subscribeProgress(onChange: () => void) {
  progressListeners.add(onChange);
  return () => {
    progressListeners.delete(onChange);
  };
}

/** What the pilot is holding right now; read by the frame loop every step. */
type Held = { climb: boolean; descend: boolean; slower: boolean; faster: boolean };
const NOTHING_HELD: Held = { climb: false, descend: false, slower: false, faster: false };

/**
 * Keys. ↑/W/Space/Enter climb (a flap in ATTI MAN), ↓/S descend, ←/→ (A/D)
 * move the throttle; 1–5 pick a mode and M steps through the allowed ones.
 */
function heldKeyFor(key: string): keyof Held | null {
  if (key === " " || key === "Enter" || key === "ArrowUp" || key === "w" || key === "W") return "climb";
  if (key === "ArrowDown" || key === "s" || key === "S") return "descend";
  if (key === "ArrowLeft" || key === "a" || key === "A") return "slower";
  if (key === "ArrowRight" || key === "d" || key === "D") return "faster";
  return null;
}

/** Frame rate while nothing is being flown: waiting for a press, or after a run has settled. */
const RESTING_FPS = 24;
/** How long the crash dust gets at the full frame rate before the canvas rests. */
const CRASH_SETTLE_MS = 1500;

const STAR_LINE = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);

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
  /** The mission this was read from; a stale one is recomputed during render. */
  planId: string | null;
  status: GameState["status"];
  impact: Impact | null;
  zone: number;
  mode: FlightMode;
  /** Modes the switch accepts right now, joined: a cheap thing to compare every frame. */
  allowed: string;
  stars: number;
  inspected: number;
  battery: number;
};

function hudOf(s: GameState): Hud {
  return {
    planId: s.plan?.id ?? null,
    status: s.status,
    impact: s.impact,
    zone: s.droneZone,
    mode: s.mode,
    allowed: allowedModes(s).join(","),
    stars: missionStars(s),
    inspected: s.inspected,
    battery: batteryLeft(s),
  };
}

export function EliosGame({ className = "mt-4", leaderboard = false, paused = false }: EliosGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const plans = useMemo(() => MISSIONS.map(buildPlan), []);
  // Server render has no localStorage, so the server snapshot is no progress.
  const progress = useSyncExternalStore(subscribeProgress, readProgress, () => NO_PROGRESS);
  /** The mission picked in the list; null until the player picks one, then progress decides. */
  const [picked, setPicked] = useState<number | null>(null);
  const missionIndex = picked ?? nextMission(progress);
  const mission = MISSIONS[missionIndex];
  const stateRef = useRef<GameState>(createMission(plans[0]));
  const [hud, setHud] = useState<Hud>(() => hudOf(createMission(plans[0])));
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

  // The run on the canvas follows the mission in the list — which, on a first
  // visit, progress picks after mount. Only refs change here; the overlay
  // reads the new mission during render until the next HUD update.
  useEffect(() => {
    if (stateRef.current.plan?.id === mission.id) return;
    stateRef.current = createMission(plans[missionIndex]);
    heldRef.current = NOTHING_HELD;
  }, [mission.id, missionIndex, plans]);

  /** A press: launches, retries after a run ends, and flaps in ATTI MAN. */
  const press = useCallback(() => {
    if (paused) return;
    const s = stateRef.current;
    const over = s.status !== "idle" && s.status !== "flying";
    stateRef.current = over && s.plan ? flap(createMission(s.plan)) : flap(s);
    setHud(hudOf(stateRef.current));
  }, [paused]);

  const chooseMode = useCallback((next: FlightMode) => {
    stateRef.current = setMode(stateRef.current, next);
    setHud(hudOf(stateRef.current));
  }, []);

  const chooseMission = useCallback(
    (index: number) => {
      if (!isUnlocked(index, readProgress()) || stateRef.current.status === "flying") return;
      setPicked(index);
      stateRef.current = createMission(plans[index]);
      heldRef.current = NOTHING_HELD;
      setHud(hudOf(stateRef.current));
    },
    [plans],
  );

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
    let endedAt = -Infinity;

    const frame = (now: number) => {
      if (stopped) return;

      // Waiting for a press is most of the game's life — the composer shows
      // it for as long as the form is open. The hover and the far-wall drift
      // read the same at a low rate, and drawing the lit canvas at the display
      // rate cost half a core doing nothing. A run, and the dust that ends
      // one, keep the full rate.
      const status = stateRef.current.status;
      const resting = status === "idle" || (status !== "flying" && now - endedAt > CRASH_SETTLE_MS);
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

      if (before.status === "flying" && after.status !== "flying") {
        endedAt = now;
        const stars = missionStars(after);
        if (after.plan && stars > 0) writeProgress(recordStars(readProgress(), after.plan.id, stars));
        if (POST_SCORES && leaderboard && after.score > 0) void submitScoreRef.current(after.score);
        setHud(hudOf(after));
      } else if (
        after.inspected !== before.inspected ||
        after.mode !== before.mode ||
        allowedModes(after).length !== allowedModes(before).length
      ) {
        setHud(hudOf(after));
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
        const allowed = allowedModes(stateRef.current);
        const i = allowed.indexOf(stateRef.current.mode);
        if (allowed.length > 0) chooseMode(allowed[(i + 1) % allowed.length]);
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

  const view = hud.planId === mission.id ? hud : hudOf(createMission(plans[missionIndex]));
  const where = ZONE_NAMES[ZONES[view.zone]]?.name.toLowerCase();
  const allowed = view.allowed.split(",");
  const flying = view.status === "flying";
  const plan = plans[missionIndex];
  const totalStars = MISSIONS.reduce((sum, m) => sum + (progress[m.id] ?? 0), 0);
  const nextOpen = missionIndex + 1 < MISSIONS.length && isUnlocked(missionIndex + 1, progress);

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Fly where people can't, mission ${missionIndex + 1}: ${mission.title}. Space or up to climb, down to descend, left and right for speed, number keys for the flight mode.`}
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
        {!flying ? (
          // The scene behind is always dark, whatever the app theme, so the
          // title card uses fixed light text rather than theme tokens. It
          // sits low, under the drone rather than over it.
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/85 via-black/35 to-transparent px-4 pb-[6%] text-center">
            <div className="max-w-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/90">
                Mission {missionIndex + 1} · {mission.title}
              </p>
              {view.status === "idle" ? (
                <>
                  <p className="mt-1.5 text-[12px] leading-snug text-white/90">{mission.brief}</p>
                  <p className="mt-1 text-[10px] text-white/55">
                    {plan.pois} to inspect · {plan.battery} s battery ·{" "}
                    {mission.modes.map((m) => MODE_SPECS[m].label).join(", ")}
                  </p>
                </>
              ) : view.status === "complete" ? (
                <>
                  <p className="mt-1.5 text-lg leading-none tracking-widest text-amber-200">{STAR_LINE(view.stars)}</p>
                  <p className="mt-1 text-[11px] text-white/75">
                    Out through the exit · {view.inspected}/{plan.pois} inspected ·{" "}
                    {Math.round(view.battery * 100)}% battery left
                  </p>
                </>
              ) : view.status === "landed" ? (
                <p className="mt-1.5 text-sm font-medium text-white">
                  Battery flat before the exit — {view.inspected}/{plan.pois} inspected.
                </p>
              ) : (
                <>
                  <p className="mt-1.5 text-sm font-medium text-white">Mission failed.</p>
                  {view.impact && where ? (
                    <p className="mt-0.5 text-[11px] text-white/65">
                      Hit {KIND_LABELS[view.impact.what]} in the {where} above 2 m/s — too fast for the cage.
                    </p>
                  ) : null}
                </>
              )}
              <p className="mt-1.5 text-[11px] text-white/65">
                Tap or press space to {view.status === "idle" ? "launch" : "fly it again"}
              </p>
              {view.status === "idle" ? (
                <p className="mt-0.5 text-[10px] text-white/45">
                  {MODE_SPECS[view.mode].altitudeHold
                    ? "Hold top half / ↑ to climb, bottom half / ↓ to descend · ← → speed · linger by ⊕ to inspect"
                    : "Tap / space to flap against gravity · ← → speed · linger by ⊕ to inspect"}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* In flight: the mode switch, limited to what the job (and the dust) allows. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {mission.modes.map((option) => {
          const spec = MODE_SPECS[option];
          const on = view.mode === option;
          const usable = allowed.includes(option);
          const limit = option === "ATTI_MAN" ? "unlimited" : `${(spec.maxSpeed * METRES_PER_UNIT).toFixed(1)} m/s max`;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              disabled={!usable}
              title={`${spec.holds} · ${limit} · key ${FLIGHT_MODES.indexOf(option) + 1}${usable ? "" : " · unavailable here"}`}
              onClick={() => chooseMode(option)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:line-through disabled:opacity-40 ${
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

      {/* Between runs: the missions, each opened by flying out the one before. */}
      {!flying ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-ink-5">
            <span>Missions</span>
            <span>
              {totalStars}/{MISSIONS.length * 3} ★
              {view.status === "complete" && nextOpen ? (
                <button
                  type="button"
                  onClick={() => chooseMission(missionIndex + 1)}
                  className="ml-3 font-medium text-accent-soft hover:underline"
                >
                  Next mission →
                </button>
              ) : null}
            </span>
          </div>
          <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {MISSIONS.map((m, i) => {
              const open = isUnlocked(i, progress);
              const on = i === missionIndex;
              const stars = progress[m.id] ?? 0;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={!open}
                    aria-current={on ? "true" : undefined}
                    onClick={() => chooseMission(i)}
                    className={`w-full rounded-lg border px-2 py-1.5 text-left text-[11px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      on ? "border-accent/60 bg-accent/10 text-ink" : "border-glass/20 text-ink-3 hover:text-ink"
                    }`}
                  >
                    <span className="block truncate font-medium">
                      {i + 1}. {m.title}
                    </span>
                    <span className="text-amber-300/90">{open ? STAR_LINE(stars) : "Locked"}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {showBoard ? (
        <div className="mt-2 flex items-start justify-between gap-3">
          {pending !== null ? (
            <p className="text-[11px] text-ink-5/80">{pending} waiting to post to the board</p>
          ) : (
            <span />
          )}
          {board && board.length > 0 ? (
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
      ) : null}
    </div>
  );
}
