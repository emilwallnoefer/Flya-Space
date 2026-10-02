/**
 * Things that happen to the Elios mid-run — the reasons a real inspection
 * drone gets into trouble in a confined space, most of them straight off the
 * Elios 3's own warning list (the codes on screen are the real ones):
 *
 *   Dust (VIO)            cameras and lidar blinded: an Assist space drops
 *                         to FORCED ATTI, and the picture fogs
 *   Draft                 a shaft or stack blows through; Assist holds
 *                         position against it, ATTI is carried by it
 *   Weak signal (T01)     the video lags; it can drop out entirely (T13),
 *                         and after five seconds — three here — the drone
 *                         flies itself back along its path (Return-to-Signal)
 *                         unless the pilot cancels
 *   Lighting error (S16)  the panel goes dark; only the lidar sees
 *   Hanging cables        rigging hanging into the gaps; go under it
 *   Radiation (E04)       a hot band across the space: the dose builds the
 *                         closer you fly to it
 *   Gas (PA08)            a layer of it — methane under the roof, hydrogen
 *                         sulphide on the floor; stay out of it
 *
 * Pure and `Math.random()`-free, like the flight rules: which event comes and
 * which way a draft blows are draws passed in by the caller.
 *
 * Only types come from `elios-flight.ts`, which imports from here.
 */

import type { Zone } from "@/lib/elios-flight";

/** Metres per world unit — the same scale as the flight rules. */
const METRES_PER_UNIT = 0.022;
const mps = (metres: number) => metres / METRES_PER_UNIT;

export const EVENT_KINDS = [
  "DUST",
  "DRAFT",
  "SIGNAL",
  "DARKNESS",
  "CABLES",
  "RADIATION",
  "GAS",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventSpec = {
  /** The warning code, as the Elios 3 cockpit shows it. */
  code: string;
  title: string;
  /** What to do about it, in as few words as fit on the HUD. */
  hint: string;
  zones: readonly Zone[] | "ANY";
  /** How far the event lasts, in world units flown — so speed shortens it. */
  length: number;
  /** Obstacles cleared before it can turn up at all. */
  minScore: number;
  weight: number;
};

export const EVENT_SPECS: Record<EventKind, EventSpec> = {
  DUST: {
    code: "VIO",
    title: "Dust — cameras and lidar blind",
    hint: "Assist is blind — it drifts now",
    zones: ["BOILER", "BALLAST", "SEWER", "MINE"],
    length: 750,
    minScore: 0,
    weight: 3,
  },
  DRAFT: {
    code: "WND",
    title: "Draft through the space",
    hint: "Assist holds against it — ATTI drifts",
    zones: ["MINE", "BALLAST", "BOILER", "TANK", "SEWER"],
    length: 700,
    minScore: 0,
    weight: 2,
  },
  SIGNAL: {
    code: "T01",
    title: "Weak radio signal",
    hint: "Video lagging — slow down",
    zones: ["TANK", "SEWER", "MINE"],
    length: 900,
    minScore: 0,
    weight: 2,
  },
  DARKNESS: {
    code: "S16",
    title: "Lighting panel error",
    hint: "Lidar view only — slow down",
    zones: "ANY",
    length: 700,
    minScore: 3,
    weight: 2,
  },
  CABLES: {
    code: "!",
    title: "Hanging cables",
    hint: "Go under them",
    zones: ["MINE", "SEWER", "BALLAST"],
    length: 500,
    minScore: 2,
    weight: 2,
  },
  RADIATION: {
    code: "E04",
    title: "Radiation field",
    hint: "Keep away from the hot band",
    zones: ["BOILER", "TANK"],
    length: 900,
    minScore: 6,
    weight: 2,
  },
  GAS: {
    code: "PA08",
    title: "Critical LEL — gas layer",
    hint: "Stay out of the gas",
    zones: ["MINE", "SEWER"],
    length: 800,
    minScore: 6,
    weight: 2,
  },
};

/**
 * `warning` is the second of notice before it bites. A signal event can go on
 * from `active` to `lost` (the countdown to Return-to-Signal) and `rts` (the
 * drone flying itself back).
 */
export type EventPhase = "warning" | "active" | "lost" | "rts";

export type ActiveEvent = {
  kind: EventKind;
  phase: EventPhase;
  /** Seconds in the current phase. */
  t: number;
  /** World units still to fly before it ends. */
  left: number;
  /** For a draft: -1 blows up, 1 blows down. */
  dir: 1 | -1;
  /** For a weak signal: whether it will drop out entirely halfway through. */
  escalates: boolean;
};

/** Seconds of notice before an event takes effect. */
export const WARNING_TIME = 1.2;
/** Seconds in a radiation field to the dose limit; the meter ebbs slowly outside. */
export const DOSE_TIME = 7;
export const DOSE_DECAY = 0.05;
/** Seconds in the gas layer to the limit, and how fast the meter drains outside it. */
export const LEL_TIME = 2.2;
export const LEL_FALL = 0.6;
/** How late the controls arrive over a weak link. */
export const SIGNAL_LAG = 0.3;
/** The window to cancel Return-to-Signal (five seconds on the real aircraft), and how long it flies back. */
export const LOST_TIME = 3;
export const RTS_TIME = 1.6;
export const RTS_SPEED = mps(1.5);
/** How far into a run the first event waits. */
export const FIRST_EVENT = 650;

/** Clear air between one event ending and the next, shrinking as the run goes on. */
export function eventGap(score: number): number {
  return Math.max(450, 1400 - Math.max(0, score) * 15);
}

/** Which event comes next in this space at this point in the run, from a draw in [0, 1). */
export function pickEvent(zone: Zone, score: number, draw: number): EventKind | null {
  const pool = EVENT_KINDS.filter((k) => {
    const spec = EVENT_SPECS[k];
    return score >= spec.minScore && (spec.zones === "ANY" || spec.zones.includes(zone));
  });
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, k) => sum + EVENT_SPECS[k].weight, 0);
  let pick = (Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999) : 0.5) * total;
  for (const k of pool) {
    pick -= EVENT_SPECS[k].weight;
    if (pick < 0) return k;
  }
  return pool[pool.length - 1];
}

/** A second draw derived from the first, for the details of an event. */
export function detailDraw(draw: number): number {
  const d = Number.isFinite(draw) ? draw : 0.5;
  return (d * 7919.123) % 1;
}

export function startEvent(kind: EventKind, draw: number): ActiveEvent {
  const detail = detailDraw(draw);
  return {
    kind,
    phase: "warning",
    t: 0,
    left: EVENT_SPECS[kind].length,
    dir: detail < 0.5 ? -1 : 1,
    escalates: kind === "SIGNAL" && detail < 0.6,
  };
}

/** Is the event biting yet — past its warning? */
export function isLive(event: ActiveEvent | null, kind?: EventKind): boolean {
  return !!event && event.phase !== "warning" && (kind === undefined || event.kind === kind);
}
