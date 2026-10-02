/**
 * Physics, geometry and rules for "Fly where people can't".
 *
 * The run flies through the confined spaces the Elios 3 actually inspects — a
 * boiler, a ballast tank, a mine stope, a sewer, a storage tank — and every
 * obstacle is something a pilot meets in there: superheater pendants, web
 * frames with lightening holes, hang-ups in an ore pass, root intrusions,
 * agitators. Each space is sealed off from the next by a bulkhead with a
 * manhole in it, which is how you get from one confined space to another.
 *
 * Obstacles are real shapes, not a pair of rectangles wearing a skin. The
 * collision test runs against exactly the polygons and discs the renderer
 * draws, so a clinker heap is as ragged in play as it looks and a flange is
 * round. What you see is what you hit.
 *
 * Everything here is pure: no canvas, no `Date.now()`, no `Math.random()`. The
 * caller passes the timestep and the draws in — ragged shapes come from a
 * seeded generator — so a whole run replays exactly in a test, the same
 * discipline `fleet-rules.ts` follows.
 *
 * The run is flown in one of five flight modes (`MODE_SPECS`), switchable
 * mid-flight, on a throttle the pilot controls, until the battery runs flat;
 * the score is obstacles cleared on one battery. The collision-tolerant cage
 * is a rule about speed, not mode: at or below `SAFE_SPEED` contact bounces,
 * above it contact is a crash. The ATTI MAN flap physics and the obstacle
 * spacing are unchanged from the first version of the game; changing any of
 * this changes what a score means, so it comes with a leaderboard reset and a
 * bump of `ELIOS_RULES_VERSION`.
 */

import {
  COOL_RATE,
  DOSE_DECAY,
  DOSE_TIME,
  DRAFT_ASSIST,
  DRAFT_ATTI,
  DRAFT_MANUAL,
  EVAC_SPEED,
  EVENT_SPECS,
  FIRST_EVENT,
  HEAT_TIME,
  LEL_FALL,
  LEL_TIME,
  LIDAR_RECOVER,
  LOST_TIME,
  RTS_SPEED,
  RTS_TIME,
  SIGNAL_LAG,
  WARNING_TIME,
  deniedModes,
  detailDraw,
  erraticJolt,
  eventGap,
  isLive,
  pickEvent,
  startEvent,
  type ActiveEvent,
  type EventKind,
} from "@/lib/elios-events";

/**
 * Fixed world units. The canvas scales to fit, so the game plays identically at
 * any card width and the constants never need retuning for a new screen size.
 * One unit is roughly 2 cm, which makes the caged drone about the 48 cm it is.
 */
export const WORLD_WIDTH = 320;
export const WORLD_HEIGHT = 200;
/** Metres per world unit, for the proximity readout. */
export const METRES_PER_UNIT = 0.022;

/** Downward acceleration, world units per second squared. */
export const GRAVITY = 420;
/** Upward kick of a single flap, world units per second. */
export const FLAP_VELOCITY = -145;
/** Terminal velocity, so a long fall stays readable rather than teleporting. */
export const MAX_FALL_SPEED = 220;

export const DRONE_X = 68;
/** The Elios 3 flies inside a cage — one radius covers the whole aircraft. */
export const DRONE_RADIUS = 11;

/**
 * The Elios flies in five modes, the ones on the real remote. Each one caps
 * the forward speed and decides how much the aircraft holds for the pilot:
 *
 *   Assist        position + altitude hold   1.5 m/s
 *   Assist Sport  position + altitude hold   2 m/s
 *   ATTI          altitude hold only         5 m/s
 *   ATTI Sport    altitude hold only         7 m/s
 *   ATTI MAN      nothing held               unlimited
 *
 * In the side view, up/down is altitude and left/right is forward speed:
 *
 * - Position hold means the speed you set is the speed you fly: the aircraft
 *   brakes and accelerates hard, and nothing pushes it around.
 * - Without it (ATTI) the forward speed has momentum and drifts with the air,
 *   so braking for an obstacle is something you start early.
 * - Altitude hold means no gravity: hold to climb, hold to descend, let go and
 *   it stays where it is. ATTI MAN drops it, and you are back to flapping
 *   against gravity — the game as it always was.
 *
 * `maxSpeed` and the rates are in world units per second; `speedTau` is how
 * long the forward speed takes to cover most of the way to the throttle
 * setting; `gust` is how hard the air pushes on an aircraft that is not
 * holding its position.
 */
export const FLIGHT_MODES = ["ASSIST", "ASSIST_SPORT", "ATTI", "ATTI_SPORT", "ATTI_MAN"] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export type ModeSpec = {
  label: string;
  holds: string;
  maxSpeed: number;
  /** Altitude hold: no gravity, climb and descend at `climbRate` on request. */
  altitudeHold: boolean;
  climbRate: number;
  speedTau: number;
  gust: number;
};

const mps = (metres: number) => metres / METRES_PER_UNIT;

export const MODE_SPECS: Record<FlightMode, ModeSpec> = {
  ASSIST: { label: "Assist", holds: "Position + altitude hold", maxSpeed: mps(1.5), altitudeHold: true, climbRate: 95, speedTau: 0.25, gust: 0 },
  ASSIST_SPORT: { label: "Assist Sport", holds: "Position + altitude hold", maxSpeed: mps(2), altitudeHold: true, climbRate: 110, speedTau: 0.3, gust: 0 },
  ATTI: { label: "ATTI", holds: "Altitude hold only", maxSpeed: mps(5), altitudeHold: true, climbRate: 125, speedTau: 1.1, gust: 22 },
  ATTI_SPORT: { label: "ATTI Sport", holds: "Altitude hold only", maxSpeed: mps(7), altitudeHold: true, climbRate: 165, speedTau: 0.9, gust: 22 },
  // "Unlimited" still needs a number: 12 m/s crosses the screen in half a second.
  ATTI_MAN: { label: "ATTI MAN", holds: "No stabilisation", maxSpeed: mps(12), altitudeHold: false, climbRate: 0, speedTau: 1.2, gust: 26 },
};

/** How fast holding the throttle moves the speed setting, world units per second per second. */
export const THROTTLE_RATE = mps(2.5);
/** Speed setting a run starts with, clipped to the mode: right on the edge of the cage. */
export const START_SPEED = mps(2);
/** How quickly an altitude-holding aircraft reaches the climb rate asked for. */
export const VERTICAL_TAU = 0.12;
/** Seconds of flight on one battery. The score is obstacles cleared before it runs out. */
export const BATTERY_SECONDS = 90;

/**
 * Below this forward speed (2 m/s on the readout) the cage takes the hit: the
 * drone bounces off whatever it touched and keeps flying, the way the real
 * collision-tolerant Elios does. Above it, contact is a crash — in every mode.
 * The mode does not protect you; your speed does. Assist and Assist Sport
 * simply cannot go fast enough to lose it.
 */
export const SAFE_SPEED = 2 / METRES_PER_UNIT;
/** Share of the vertical speed the cage keeps through a bounce. */
export const BOUNCE_RESTITUTION = 0.55;
/** A head-on bump throws the world back at this speed, world units per second… */
export const BOUNCE_RECOIL = 110;
/** …which dies away at this rate per second, so the run picks up again within half a second. */
export const RECOIL_DECAY = 6;
/** Clear air between one obstacle and the next. */
export const OBSTACLE_GAP = 112;
/** Never open a passage tighter than this, or it stops being playable. */
export const MIN_PASSAGE = 52;
/** Keep a passage off the very floor and ceiling, where it is unfair. */
export const EDGE_MARGIN = 20;

/** Obstacles per space before a bulkhead opens onto the next one. */
export const ZONE_LENGTH = 7;

const H = WORLD_HEIGHT;

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export const ZONES = ["BOILER", "BALLAST", "MINE", "SEWER", "TANK"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_NAMES: Record<Zone, { name: string; industry: string }> = {
  BOILER: { name: "Boiler", industry: "Power generation" },
  BALLAST: { name: "Ballast tank", industry: "Maritime" },
  MINE: { name: "Stope", industry: "Mining" },
  SEWER: { name: "Sewer", industry: "Wastewater" },
  TANK: { name: "Storage tank", industry: "Oil & gas" },
};

/**
 * The air an aircraft without position hold drifts in: a smooth, repeatable
 * push, so a run replays exactly. Zero in the Assist modes.
 */
export function gustAt(mode: FlightMode, elapsed: number): number {
  const g = MODE_SPECS[mode].gust;
  if (g === 0) return 0;
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  return (g * (Math.sin(0.83 * t) + 0.7 * Math.sin(2.1 * t + 1.7) + 0.4 * Math.sin(4.3 * t + 0.4))) / 2.1;
}

/** Is the drone slow enough right now for the cage to take a hit? */
export function isCollisionTolerant(state: Pick<GameState, "speed">): boolean {
  return Math.abs(state.speed) <= SAFE_SPEED + 1e-9;
}

/**
 * How fast the obstacles are actually moving: the forward speed, less whatever
 * a head-on bounce is still throwing the world back by. Negative while it does.
 */
export function worldSpeed(state: Pick<GameState, "speed" | "recoil">): number {
  return state.speed - state.recoil;
}

/** Share of the battery left, 1 at launch and 0 when the run ends. */
export function batteryLeft(state: Pick<GameState, "elapsed">): number {
  return Math.max(0, 1 - state.elapsed / BATTERY_SECONDS);
}

/** The zone at a (possibly out-of-range) index, wrapping like the run does. */
export function zoneAt(index: number): Zone {
  const n = ZONES.length;
  const i = Number.isFinite(index) ? Math.floor(index) : 0;
  return ZONES[((i % n) + n) % n];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type Vec = readonly [number, number];

/** A solid the drone can hit. Local x is relative to the obstacle's left edge. */
export type Solid =
  | { readonly shape: "poly"; readonly points: readonly Vec[] }
  | { readonly shape: "disc"; readonly cx: number; readonly cy: number; readonly r: number };

/**
 * The obstacle vocabulary, grouped by the space it belongs to. Within a space
 * each kind is a genuinely different problem to fly — thread a gap, go over,
 * go under, pick a side of something in mid-air — rather than a restyled
 * column.
 */
export const OBSTACLE_KINDS = [
  "BULKHEAD",
  // Boiler
  "PENDANT",
  "CLINKER",
  "HOPPER",
  "PLATEN",
  "TUBE_BANK",
  // Ballast tank
  "WEB_FRAME",
  "BRACKETS",
  "CROSS_TIE",
  "STRINGER",
  "DOUBLE_FRAME",
  // Mine
  "ROCK_JAW",
  "HANGING_ROCK",
  "MUCK_PILE",
  "HANGUP",
  "VENT_DUCT",
  // Sewer
  "ROOTS",
  "DEBRIS",
  "DROP_PIPE",
  "COLLAPSE",
  "PENSTOCK",
  // Storage tank
  "AGITATOR",
  "ROOF_LEGS",
  "HEATING_COILS",
  "INLET",
  "SWING_LINE",
] as const;

export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export const ZONE_KINDS: Record<Zone, readonly ObstacleKind[]> = {
  BOILER: ["PENDANT", "CLINKER", "HOPPER", "PLATEN", "TUBE_BANK"],
  BALLAST: ["WEB_FRAME", "BRACKETS", "CROSS_TIE", "STRINGER", "DOUBLE_FRAME"],
  MINE: ["ROCK_JAW", "HANGING_ROCK", "MUCK_PILE", "HANGUP", "VENT_DUCT"],
  SEWER: ["ROOTS", "DEBRIS", "DROP_PIPE", "COLLAPSE", "PENSTOCK"],
  TANK: ["AGITATOR", "ROOF_LEGS", "HEATING_COILS", "INLET", "SWING_LINE"],
};

/** What the crash screen says you flew into — the name an inspector would use. */
/** Everything a run can end on: steel, the floor and roof, and what the events bring. */
export type ImpactKind = ObstacleKind | "FLOOR" | "CEILING" | "CABLE" | "RADIATION" | "GAS";

export const KIND_LABELS: Record<ImpactKind, string> = {
  CABLE: "a hanging cable",
  RADIATION: "the radiation dose limit",
  GAS: "an explosive atmosphere",
  BULKHEAD: "the edge of a manhole",
  PENDANT: "a superheater pendant",
  CLINKER: "a clinker heap",
  HOPPER: "the ash hopper slope",
  PLATEN: "a division wall",
  TUBE_BANK: "an economiser tube bank",
  WEB_FRAME: "a web frame",
  BRACKETS: "a bracketed stiffener",
  CROSS_TIE: "a cross tie",
  STRINGER: "a stringer deck",
  DOUBLE_FRAME: "a web frame",
  ROCK_JAW: "a rock constriction",
  HANGING_ROCK: "loose rock in the back",
  MUCK_PILE: "the muck pile",
  HANGUP: "a hang-up",
  VENT_DUCT: "the vent duct",
  ROOTS: "a root intrusion",
  DEBRIS: "a debris pile",
  DROP_PIPE: "a drop pipe",
  COLLAPSE: "a partial collapse",
  PENSTOCK: "a penstock gate",
  AGITATOR: "the agitator",
  ROOF_LEGS: "a roof support leg",
  HEATING_COILS: "the heating coils",
  INLET: "an inlet nozzle",
  SWING_LINE: "the swing line",
  FLOOR: "the floor",
  CEILING: "the roof",
};

export type Obstacle = {
  /** Unique within a run, so the renderer can cache one sprite per obstacle. */
  id: number;
  /** Left edge in world units; moves right-to-left. */
  x: number;
  kind: ObstacleKind;
  /** Index into ZONES of the space this obstacle stands in. */
  zone: number;
  /** Seed its ragged edges were cut from; the renderer reuses it for detail. */
  seed: number;
  width: number;
  solids: readonly Solid[];
  /** Scored once, when the drone is fully past the trailing edge. */
  passed: boolean;
  /** A cable hanging from the roof in the gap behind this obstacle, this long. */
  cable?: number;
};

/** The middle of the clear gap behind an obstacle, where a cable hangs. */
export function gapX(o: Pick<Obstacle, "x" | "width">): number {
  return o.x + o.width + OBSTACLE_GAP / 2;
}

/** Cables hang this long at most, so there is always room beneath one. */
export const MAX_CABLE = 92;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0.5);

/** A draw in [0, 1] as a 32-bit seed. */
export function seedFromDraw(draw: number): number {
  return Math.floor(clamp01(draw) * 0xffffffff) >>> 0;
}

/** mulberry32: small, fast and good enough to cut a rock with. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(x: number, y: number, w: number, h: number): Solid {
  return { shape: "poly", points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
}

function poly(points: readonly Vec[]): Solid {
  return { shape: "poly", points };
}

const ARC_STEPS = 4;

/** A rectangle with rounded corners as a polygon; radii run TL, TR, BR, BL. */
export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: readonly [number, number, number, number],
): Vec[] {
  const pts: Vec[] = [];
  const arc = (cx: number, cy: number, r: number, a0: number) => {
    if (r <= 0) {
      pts.push([cx, cy]);
      return;
    }
    for (let i = 0; i <= ARC_STEPS; i += 1) {
      const a = a0 + (Math.PI / 2) * (i / ARC_STEPS);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(x + tl, y + tl, tl, Math.PI);
  arc(x + w - tr, y + tr, tr, Math.PI * 1.5);
  arc(x + w - br, y + h - br, br, 0);
  arc(x + bl, y + h - bl, bl, Math.PI / 2);
  return pts;
}

/** Mirror a solid top-to-bottom, turning a floor fixture into a roof one. */
function flipV(solid: Solid): Solid {
  if (solid.shape === "disc") return { ...solid, cy: H - solid.cy };
  return { shape: "poly", points: solid.points.map(([x, y]) => [x, H - y] as Vec) };
}

type MassOptions = {
  /** Where along the width the mass reaches furthest, 0..1. */
  tip: number;
  /** How far the edges reach, as a share of the tip's reach. */
  shoulder: number;
  /** Points along the ragged edge. */
  points: number;
  /** How much each point may fall short of its envelope. */
  rough: number;
};

/**
 * Something growing down from the roof — slag, a rock slab, broken crown — as
 * one polygon: the roof, then a ragged edge from right to left that reaches
 * exactly `reach` at the tip and never beyond it. That guarantee is what keeps
 * a random shape from closing the passage.
 */
function ceilingMass(width: number, reach: number, rand: () => number, o: MassOptions): Vec[] {
  const pts: Vec[] = [[0, 0], [width, 0]];
  const tipX = o.tip * width;
  const step = width / (o.points - 1);
  let tipPlaced = false;
  for (let i = o.points - 1; i >= 0; i -= 1) {
    const edge = i === 0 || i === o.points - 1;
    const x = edge ? i * step : i * step + (rand() - 0.5) * step * 0.5;
    if (!tipPlaced && x < tipX) {
      pts.push([tipX, reach]);
      tipPlaced = true;
    }
    const d = Math.min(Math.abs(x / width - o.tip) / Math.max(o.tip, 1 - o.tip), 1);
    const envelope = o.shoulder + (1 - o.shoulder) * (1 - d ** 1.5);
    pts.push([x, reach * envelope * (1 - o.rough * rand())]);
  }
  if (!tipPlaced) pts.push([tipX, reach]);
  return pts;
}

/** The same, standing on the floor. */
function floorMass(width: number, reach: number, rand: () => number, o: MassOptions): Vec[] {
  return ceilingMass(width, reach, rand, o).map(([x, y]) => [x, H - y] as Vec);
}

/** Points along a circular arc, both ends included. */
function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 8): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + (to - from) * (i / steps);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * The plates above and below an opening, `x0`..`x0 + width` wide. A `round`
 * opening is cut as a stadium — the shape of a lightening hole or a manhole —
 * by arching both plates away from the gap. The arch only ever removes steel,
 * so the narrowest point of the passage is still exactly `top`..`bottom`.
 */
function platesAround(x0: number, width: number, top: number, bottom: number, round: boolean): Solid[] {
  if (!round) return [rect(x0, 0, width, top), rect(x0, bottom, width, H - bottom)];
  const r = width / 2;
  const cx = x0 + r;
  return [
    poly([[x0, 0], [x0 + width, 0], ...arc(cx, top, r, 0, -Math.PI)]),
    poly([[x0 + width, H], [x0, H], ...arc(cx, bottom, r, Math.PI, 0)]),
  ];
}

/** Radius of the vent duct, and how far below the back its hangers hold it. */
export const VENT_DUCT_RADIUS = 11;
const VENT_DUCT_HANG = 10;

/**
 * The vent duct's path and outline, shared by collision and drawing so the
 * two cannot disagree: up a riser at the left, round an elbow, along a
 * sagging run, round the other elbow and up again. `outline` is the solid —
 * everything from the back down to the duct's outer wall.
 */
export function ventDuct(width: number, sag: number): { centre: Vec[]; outline: Vec[] } {
  const r = VENT_DUCT_RADIUS;
  const bend = r + 1;
  const xr = r + 0.5;
  const run = (x: number) => VENT_DUCT_HANG + r + sag * Math.sin((Math.PI * x) / width);
  const x0 = xr + bend;
  const x1 = width - xr - bend;
  const yl = run(x0);
  const yr = run(x1);
  const middle: Vec[] = [];
  for (let x = x0 + 4; x < x1 - 1; x += 4) middle.push([x, run(x)]);
  const centre: Vec[] = [
    [xr, 0],
    ...arc(x0, yl - bend, bend, Math.PI, Math.PI / 2),
    ...middle,
    ...arc(x1, yr - bend, bend, Math.PI / 2, 0),
    [width - xr, 0],
  ];
  const lower: Vec[] = [];
  for (let x = x1 - 4; x > x0 + 1; x -= 4) lower.push([x, run(x) + r]);
  const outline: Vec[] = [
    [0.5, 0],
    [width - 0.5, 0],
    ...arc(x1, yr - bend, bend + r, 0, Math.PI / 2),
    ...lower,
    ...arc(x0, yl - bend, bend + r, Math.PI / 2, Math.PI),
  ];
  return { centre, outline };
}

/**
 * A closed Catmull-Rom curve through `points`, clamped to a box so the
 * smoothing can never push the outline past the reach its control points
 * were cut to.
 */
function smoothClosed(points: readonly Vec[], samples: number, box: [number, number, number, number]): Vec[] {
  const [minX, minY, maxX, maxY] = box;
  const n = points.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < samples; s += 1) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([
        Math.min(maxX, Math.max(minX, at(p0[0], p1[0], p2[0], p3[0]))),
        Math.min(maxY, Math.max(minY, at(p0[1], p1[1], p2[1], p3[1]))),
      ]);
    }
  }
  return out;
}

/** A wall with one opening in it, placed by `t`. */
function wallWithOpening(width: number, passage: number, t: number, round = false): Solid[] {
  const top = EDGE_MARGIN + t * (H - 2 * EDGE_MARGIN - passage);
  return platesAround(0, width, top, top + passage, round);
}

/** Top of a body of height `h` that must leave MIN_PASSAGE free above and below. */
function midAirTop(h: number, t: number): number {
  const lowest = EDGE_MARGIN + MIN_PASSAGE;
  const highest = H - EDGE_MARGIN - MIN_PASSAGE - h;
  return lowest + t * Math.max(0, highest - lowest);
}

/**
 * Build one obstacle's geometry.
 *
 * `placeDraw` places the opening; `seed` cuts the ragged edges. Every kind
 * guarantees a passage at least `MIN_PASSAGE` tall, so no layout can come out
 * unflyable — the test suite sweeps every kind to prove it.
 */
export function buildObstacle(
  kind: ObstacleKind,
  placeDraw: number,
  seed = 0,
): { width: number; solids: Solid[] } {
  const t = clamp01(placeDraw);
  const rand = seededRandom(seed);

  switch (kind) {
    // --- Between spaces ---------------------------------------------------
    case "BULKHEAD": {
      // A watertight bulkhead with a manhole: the way into the next space.
      // Generous on purpose — it is a doorway, not a test.
      return { width: 22, solids: wallWithOpening(22, MIN_PASSAGE + 34, t, true) };
    }

    // --- Boiler -----------------------------------------------------------
    case "PENDANT": {
      // A superheater pendant hanging from the roof: fly under it. The tubes
      // return in nested U-bends, so the bottom is a full half-round.
      const width = 36;
      const length = 70 + t * 48;
      const bend = width / 2;
      return { width, solids: [poly(roundedRect(0, 0, width, length, [0, 0, bend, bend]))] };
    }
    case "CLINKER": {
      // A heap of fused slag on the furnace floor: fly over it.
      const width = 56;
      const reach = 44 + t * 22;
      const tip = 0.35 + rand() * 0.3;
      return {
        width,
        solids: [poly(floorMass(width, reach, rand, { tip, shoulder: 0.14, points: 9, rough: 0.24 }))],
      };
    }
    case "HOPPER": {
      // The sloped tube wall of the ash hopper: read the climb early.
      const width = 64;
      const rise = 60 + t * 16;
      return { width, solids: [poly([[0, H], [width, H - rise], [width, H]])] };
    }
    case "PLATEN": {
      // A division wall of tubes with a bent-out lane through it.
      return { width: 28, solids: wallWithOpening(28, MIN_PASSAGE + 22, t) };
    }
    case "TUBE_BANK": {
      // An economiser bank end-on, hanging in the gas path: pick a side.
      const width = 42;
      const h = 50;
      const top = midAirTop(h, t);
      return { width, solids: [poly(roundedRect(0, top, width, h, [5, 5, 5, 5]))] };
    }

    // --- Ballast tank -----------------------------------------------------
    case "WEB_FRAME": {
      // A transverse web frame; the lightening hole is the way through.
      return { width: 18, solids: wallWithOpening(18, MIN_PASSAGE + 24, t, true) };
    }
    case "BRACKETS": {
      // A vertical stiffener with tripping brackets either side of its toe —
      // on the bottom plating or, half the time, hanging off the deckhead.
      const width = 58;
      const stem = 52 + rand() * 14;
      const left = stem * (0.5 + rand() * 0.2);
      const right = stem * (0.5 + rand() * 0.2);
      const solids: Solid[] = [
        rect(26, H - stem, 6, stem),
        poly([[0, H], [26, H], [26, H - left]]),
        poly([[32, H], [width, H], [32, H - right]]),
      ];
      return { width, solids: t >= 0.5 ? solids.map(flipV) : solids };
    }
    case "CROSS_TIE": {
      // A cross tie spanning the tank, seen end-on: an I-section in mid-air.
      const width = 40;
      const h = 48;
      const flange = 8;
      const web = 12;
      const top = midAirTop(h, t);
      const b = top + h;
      const w0 = (width - web) / 2;
      const w1 = w0 + web;
      return {
        width,
        solids: [
          poly([
            [0, top], [width, top], [width, top + flange], [w1, top + flange],
            [w1, b - flange], [width, b - flange], [width, b], [0, b],
            [0, b - flange], [w0, b - flange], [w0, top + flange], [0, top + flange],
          ]),
        ],
      };
    }
    case "STRINGER": {
      // A horizontal stringer deck edge-on, with a knee bracket under each end:
      // commit to over or under early and hold it.
      const width = 88;
      const plate = 7;
      const knee = 10;
      const lowest = EDGE_MARGIN + MIN_PASSAGE;
      const highest = H - EDGE_MARGIN - MIN_PASSAGE - plate - knee;
      const y0 = lowest + t * (highest - lowest);
      return {
        width,
        solids: [
          poly([
            [0, y0], [width, y0], [width, y0 + plate + knee], [width - 14, y0 + plate],
            [14, y0 + plate], [0, y0 + plate + knee],
          ]),
        ],
      };
    }
    case "DOUBLE_FRAME": {
      // Two web frames a bay apart with their holes offset, so clearing the
      // first leaves you badly placed for the second.
      //
      // The offset is bounded by what the drone can actually cover inside the
      // bay: an altitude-holding mode's climb rate at its top speed, and in
      // ATTI MAN one flap (about 25 units, FLAP_VELOCITY² / 2·GRAVITY) up to
      // about 4 m/s — faster than that in ATTI MAN is the pilot's own risk.
      // The test suite holds this to the flight constants.
      const width = 96;
      const bar = 16;
      const passage = MIN_PASSAGE + 20;
      const span = H - 2 * EDGE_MARGIN - passage;
      const firstTop = EDGE_MARGIN + t * span;
      // Away from whichever edge the first hole is nearer, so the second one
      // always has somewhere to go.
      const shift = (12 + rand() * 12) * (firstTop < EDGE_MARGIN + span / 2 ? 1 : -1);
      const secondTop = Math.min(EDGE_MARGIN + span, Math.max(EDGE_MARGIN, firstTop + shift));
      return {
        width,
        solids: [
          ...platesAround(0, bar, firstTop, firstTop + passage, true),
          ...platesAround(width - bar, bar, secondTop, secondTop + passage, true),
        ],
      };
    }

    // --- Mine -------------------------------------------------------------
    case "ROCK_JAW": {
      // The drift pinches: rock from the back and the floor, a gap between.
      const width = 52;
      const passage = MIN_PASSAGE + 10;
      const topTip = EDGE_MARGIN + t * (H - 2 * EDGE_MARGIN - passage);
      const bottomTip = topTip + passage;
      const upper = ceilingMass(width, topTip, rand, { tip: 0.35 + rand() * 0.3, shoulder: 0.3, points: 8, rough: 0.26 });
      const lower = floorMass(width, H - bottomTip, rand, {
        tip: 0.35 + rand() * 0.3,
        shoulder: 0.3,
        points: 8,
        rough: 0.26,
      });
      return { width, solids: [poly(upper), poly(lower)] };
    }
    case "HANGING_ROCK": {
      // A loose slab hanging out of the back (the roof, to a miner).
      const width = 48;
      const reach = 52 + t * 24;
      return {
        width,
        solids: [poly(ceilingMass(width, reach, rand, { tip: 0.3 + rand() * 0.4, shoulder: 0.25, points: 9, rough: 0.28 }))],
      };
    }
    case "MUCK_PILE": {
      // Blasted rock, long slope in front and a steep face behind.
      const width = 72;
      const reach = 44 + t * 18;
      return {
        width,
        solids: [poly(floorMass(width, reach, rand, { tip: 0.55 + rand() * 0.25, shoulder: 0.05, points: 11, rough: 0.18 }))],
      };
    }
    case "HANGUP": {
      // A boulder jammed in the ore pass — the thing the drone was sent to find.
      const width = 44;
      const r = 18;
      const cy = midAirTop(2 * r, t) + r;
      const n = 13;
      const phase = rand() * Math.PI * 2;
      const points: Vec[] = [];
      for (let i = 0; i < n; i += 1) {
        const a = phase + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.3;
        const rr = r * (0.84 + 0.16 * rand());
        points.push([width / 2 + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
      return { width, solids: [poly(points)] };
    }
    case "VENT_DUCT": {
      // Flexible vent ducting slung under the back, turning up into a raise
      // at each end — so it never reaches past its own footprint.
      const width = 116;
      return { width, solids: [poly(ventDuct(width, 4 + t * 10).outline)] };
    }

    // --- Sewer ------------------------------------------------------------
    case "ROOTS": {
      // Tree roots through a pipe joint in the crown, hanging like a tail.
      const width = 44;
      const reach = 58 + t * 30;
      const j = () => (rand() - 0.5) * 0.06;
      const tipX = width * (0.45 + rand() * 0.1);
      const control: Vec[] = [
        [width * 0.28, 0],
        [width * 0.72, 0],
        [width * (0.9 + j()), reach * (0.22 + j())],
        [width, reach * (0.45 + j())],
        [width * (0.8 + j()), reach * (0.68 + j())],
        [width * (0.62 + j()), reach * (0.88 + j() / 2)],
        [tipX, reach],
        [width * (0.4 + j()), reach * (0.9 + j() / 2)],
        [width * (0.2 + j()), reach * (0.7 + j())],
        [0, reach * (0.46 + j())],
        [width * (0.1 + j()), reach * (0.2 + j())],
      ];
      // Roots hang in curves, not facets.
      return { width, solids: [poly(smoothClosed(control, 4, [0, 0, width, reach]))] };
    }
    case "DEBRIS": {
      // Grit, brick and rag on the invert: fly over it.
      const width = 60;
      const reach = 36 + t * 18;
      return {
        width,
        solids: [poly(floorMass(width, reach, rand, { tip: 0.3 + rand() * 0.4, shoulder: 0.12, points: 10, rough: 0.3 }))],
      };
    }
    case "DROP_PIPE": {
      // A drop connection coming down through the crown, socket joints and all.
      const width = 26;
      const length = 56 + t * 34;
      const j0 = length * 0.42;
      return {
        width,
        solids: [
          poly([
            [5, 0], [5, j0], [3, j0], [3, j0 + 8], [5, j0 + 8], [5, length - 12], [3, length - 12],
            [3, length], [23, length], [23, length - 12], [21, length - 12], [21, j0 + 8],
            [23, j0 + 8], [23, j0], [21, j0], [21, 0],
          ]),
        ],
      };
    }
    case "COLLAPSE": {
      // A partial collapse: broken crown hanging down, rubble below.
      const width = 56;
      const passage = MIN_PASSAGE + 10;
      const topTip = EDGE_MARGIN + t * (H - 2 * EDGE_MARGIN - passage);
      const bottomTip = topTip + passage;
      const upper = ceilingMass(width, topTip, rand, { tip: 0.3 + rand() * 0.4, shoulder: 0.45, points: 7, rough: 0.2 });
      const lower = floorMass(width, H - bottomTip, rand, {
        tip: 0.3 + rand() * 0.4,
        shoulder: 0.2,
        points: 10,
        rough: 0.3,
      });
      return { width, solids: [poly(upper), poly(lower)] };
    }
    case "PENSTOCK": {
      // A sluice gate half raised over its weir.
      return { width: 24, solids: wallWithOpening(24, MIN_PASSAGE + 22, t) };
    }

    // --- Storage tank -----------------------------------------------------
    case "AGITATOR": {
      // A mixer shaft from the roof with its impeller at the bottom.
      const width = 48;
      const imp = 62 + t * 36;
      return {
        width,
        solids: [rect(21, 0, 6, imp), rect(0, imp, width, 12), rect(16, imp - 5, 16, 22)],
      };
    }
    case "ROOF_LEGS": {
      // Floating-roof support legs standing on the floor, footpads and all.
      const width = 52;
      const solids: Solid[] = [];
      for (const lx of [4, 22, 40]) {
        const h = 44 + rand() * 28;
        solids.push(rect(lx, H - h, 8, h), rect(lx - 3, H - 3, 14, 3));
      }
      return { width, solids };
    }
    case "HEATING_COILS": {
      // Steam coils racked along the floor: low, but long.
      const width = 84;
      const h = 28 + t * 10;
      return { width, solids: [poly(roundedRect(0, H - h, width, h, [6, 6, 0, 0]))] };
    }
    case "INLET": {
      // A flanged inlet nozzle, end-on: genuinely round.
      const width = 44;
      const r = 17;
      return { width, solids: [{ shape: "disc", cx: width / 2, cy: midAirTop(2 * r, t) + r, r }] };
    }
    case "SWING_LINE": {
      // A swing line hinged at the floor, climbing to its float.
      const width = 76;
      const rise = 56 + t * 16;
      const x0 = 7;
      const y0 = H - 7;
      const x1 = 58;
      const y1 = H - rise + 9;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = (-(y1 - y0) / len) * 4.5;
      const ny = ((x1 - x0) / len) * 4.5;
      return {
        width,
        solids: [
          rect(0, H - 12, 14, 12),
          poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]),
          poly(roundedRect(50, H - rise, 26, 15, [6, 6, 6, 6])),
        ],
      };
    }
  }
}

/**
 * Pick the next kind for a space. An immediate repeat is nudged to the next
 * kind in the list: two identical obstacles in a row read as a glitch.
 */
export function kindFor(zone: Zone, draw: number, previous: ObstacleKind | undefined): ObstacleKind {
  const kinds = ZONE_KINDS[zone];
  const safe = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999) : 0;
  const i = Math.floor(safe * kinds.length);
  return kinds[i] === previous ? kinds[(i + 1) % kinds.length] : kinds[i];
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

/** Distance from a point to a line segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const [cx, cy] = closestOnSegment(px, py, ax, ay, bx, by);
  return Math.hypot(px - cx, py - cy);
}

function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Vec {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment: fall back to the point itself.
  const t = lenSq === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / lenSq, 0), 1);
  return [ax + t * dx, ay + t * dy];
}

export function pointInPolygon(px: number, py: number, points: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const straddles = yi > py !== yj > py;
    if (straddles && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Does a circle overlap a solid? `offsetX` shifts the solid into world space. */
export function circleHitsSolid(
  cx: number,
  cy: number,
  r: number,
  solid: Solid,
  offsetX: number,
): boolean {
  if (solid.shape === "disc") {
    return Math.hypot(cx - (solid.cx + offsetX), cy - solid.cy) < r + solid.r;
  }
  const pts: Vec[] = solid.points.map(([x, y]) => [x + offsetX, y] as Vec);
  if (pointInPolygon(cx, cy, pts)) return true;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    if (distanceToSegment(cx, cy, pts[j][0], pts[j][1], pts[i][0], pts[i][1]) < r) return true;
  }
  return false;
}

/** The point on a solid nearest to (px, py), in world space. */
export function nearestPointOnSolid(px: number, py: number, solid: Solid, offsetX: number): Vec {
  if (solid.shape === "disc") {
    const cx = solid.cx + offsetX;
    const d = Math.hypot(px - cx, py - solid.cy);
    if (d === 0) return [cx, solid.cy];
    return [cx + ((px - cx) / d) * solid.r, solid.cy + ((py - solid.cy) / d) * solid.r];
  }
  const pts: Vec[] = solid.points.map(([x, y]) => [x + offsetX, y] as Vec);
  if (pointInPolygon(px, py, pts)) return [px, py];
  let best: Vec = pts[0];
  let bestD = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const c = closestOnSegment(px, py, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
    const d = Math.hypot(px - c[0], py - c[1]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function hitsObstacle(y: number, obstacle: Obstacle): boolean {
  // Cheap reject before the per-edge work.
  if (DRONE_X + DRONE_RADIUS < obstacle.x || DRONE_X - DRONE_RADIUS > obstacle.x + obstacle.width) {
    return false;
  }
  return obstacle.solids.some((s) => circleHitsSolid(DRONE_X, y, DRONE_RADIUS, s, obstacle.x));
}

/**
 * Clearance between the cage and the nearest obstacle, in world units — the
 * number the proximity readout shows. Zero or less means contact.
 */
export function clearance(y: number, obstacles: readonly Obstacle[]): number {
  let best = Math.min(y - DRONE_RADIUS, H - y - DRONE_RADIUS);
  for (const o of obstacles) {
    if (o.x > DRONE_X + 90 || o.x + o.width < DRONE_X - 90) continue;
    for (const s of o.solids) {
      const [nx, ny] = nearestPointOnSolid(DRONE_X, y, s, o.x);
      best = Math.min(best, Math.hypot(nx - DRONE_X, ny - y) - DRONE_RADIUS);
    }
  }
  return best;
}

export function hitsGround(y: number): boolean {
  return y + DRONE_RADIUS >= WORLD_HEIGHT;
}

export function hitsCeiling(y: number): boolean {
  return y - DRONE_RADIUS <= 0;
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/** `landed` is a run that flew its battery flat: it ends there, and the score stands. */
export type GameStatus = "idle" | "flying" | "crashed" | "landed";

/** Where a run ended and what it ended on — the crash screen names it. */
export type Impact = { what: ImpactKind; x: number; y: number };

export type GameState = {
  status: GameStatus;
  /** Vertical position of the drone's centre. */
  y: number;
  velocity: number;
  obstacles: Obstacle[];
  score: number;
  /** Seconds elapsed this run; drains the battery and drives the animation. */
  elapsed: number;
  /** Index into ZONES of the space the drone is flying in right now. */
  droneZone: number;
  /** Index into ZONES of the space new obstacles are being built for. */
  buildZone: number;
  /** Obstacles built so far in `buildZone`; at ZONE_LENGTH a bulkhead follows. */
  buildCount: number;
  nextId: number;
  impact: Impact | null;
  /**
   * How fast a head-on bounce is still throwing the world back, world units
   * per second. Zero unless the cage just took a hit.
   */
  recoil: number;
  /** Where the cage took a hit this step and flew on; null on a clean step. */
  bump: Impact | null;
  mode: FlightMode;
  /** Forward speed over the ground, world units per second. What the readout shows. */
  speed: number;
  /** The throttle setting the forward speed is heading for. */
  target: number;
  /** Whether things happen to the aircraft on this run (see `elios-events.ts`). */
  events: boolean;
  event: ActiveEvent | null;
  /** World units flown forward this run; events are spaced in it. */
  travelled: number;
  nextEventAt: number;
  /** Meters, 0 to 1: lidar temperature, radiation dose, gas concentration. */
  heat: number;
  dose: number;
  lel: number;
  /** The lidar overheated and has not cooled down yet: Assist is out. */
  lidarOff: boolean;
  /** The mode the pilot was in before an event forced a change; restored when it passes. */
  forcedFrom: FlightMode | null;
  /** Recent inputs, so a weak link can deliver them late. */
  inputLog: readonly LoggedInput[];
  /** An event that comes next whatever the space — for trying one out. */
  queued: EventKind | null;
};

type LoggedInput = { at: number; climb: boolean; descend: boolean; throttle: -1 | 0 | 1 };

export function createGame(
  startZone = 0,
  mode: FlightMode = "ATTI_MAN",
  target = START_SPEED,
  events = false,
): GameState {
  const zone = ZONES.indexOf(zoneAt(startZone));
  const set = clampTarget(mode, target);
  return {
    status: "idle",
    y: WORLD_HEIGHT / 2,
    velocity: 0,
    obstacles: [],
    score: 0,
    elapsed: 0,
    droneZone: zone,
    buildZone: zone,
    buildCount: 0,
    nextId: 1,
    impact: null,
    recoil: 0,
    bump: null,
    mode,
    // A run launches already cruising at its setting rather than from a standstill.
    speed: set,
    target: set,
    events,
    event: null,
    travelled: 0,
    nextEventAt: FIRST_EVENT,
    heat: 0,
    dose: 0,
    lel: 0,
    lidarOff: false,
    forcedFrom: null,
    inputLog: [],
    queued: null,
  };
}

/** Modes the pilot can switch to right now; an event can take some away. */
export function allowedModes(state: Pick<GameState, "event" | "lidarOff">): readonly FlightMode[] {
  const denied = deniedModes(state.event, state.lidarOff);
  return FLIGHT_MODES.filter((m) => !denied.includes(m));
}

/** The speed setting a forced mode change leaves the aircraft at, at most: 1.5 m/s. */
export const FORCED_SPEED = mps(1.5);

/** Where a mode the aircraft can no longer fly falls back to. */
function fallbackFrom(allowed: readonly FlightMode[]): FlightMode {
  return allowed.includes("ATTI") ? "ATTI" : (allowed[0] ?? "ATTI_MAN");
}

/**
 * Cancel Return-to-Signal inside its countdown: the pilot keeps the sticks and
 * flies on over the weak link instead of being flown back.
 */
export function cancelRts(state: GameState): GameState {
  const e = state.event;
  if (!e || e.kind !== "SIGNAL" || e.phase !== "lost") return state;
  return { ...state, event: { ...e, phase: "active", t: 0, escalates: false } };
}

function clampTarget(mode: FlightMode, target: number): number {
  const t = Number.isFinite(target) ? target : START_SPEED;
  return Math.min(Math.max(t, 0), MODE_SPECS[mode].maxSpeed);
}

/**
 * Flip the mode switch. Allowed mid-flight, the way a pilot really does it:
 * the speed setting is clipped to the new mode's limit, and the aircraft then
 * slows toward it at the new mode's rate — so dropping into Assist is the hard
 * brake, and dropping out of it leaves you coasting.
 */
export function setMode(state: GameState, mode: FlightMode): GameState {
  if (state.mode === mode || !allowedModes(state).includes(mode)) return state;
  const target = clampTarget(mode, state.target);
  // Before a run there is nothing to slow down from.
  const speed = state.status === "idle" ? target : state.speed;
  // A pilot who picks a mode has taken over from whatever an event forced.
  return { ...state, mode, target, speed, forcedFrom: null };
}

/** One tap of the throttle: a quarter metre per second, clipped to the mode. */
export const THROTTLE_STEP = mps(0.25);

/** Tap the throttle up (1) or down (-1). Holding it is `StepInput.throttle`. */
export function nudgeThrottle(state: GameState, direction: 1 | -1): GameState {
  if (state.status === "crashed" || state.status === "landed") return state;
  const target = clampTarget(state.mode, state.target + direction * THROTTLE_STEP);
  return { ...state, target, speed: state.status === "idle" ? target : state.speed };
}

/**
 * A press. From `idle` it launches the run, so one tap starts and flies — there
 * is no separate start button to hunt for. In ATTI MAN it is a flap against
 * gravity; with altitude hold, climbing is a held input to `stepGame` instead.
 */
export function flap(state: GameState): GameState {
  if (state.status === "crashed" || state.status === "landed") return state;
  if (MODE_SPECS[state.mode].altitudeHold) return state.status === "idle" ? { ...state, status: "flying" } : state;
  return { ...state, status: "flying", velocity: FLAP_VELOCITY };
}

export type StepInput = {
  /** Seconds since the last step. */
  dt: number;
  /** Draws in [0, 1): which kind of obstacle, and where its opening sits. */
  kindDraw: number;
  placeDraw: number;
  /** Draw in [0, 1) that cuts ragged shapes; defaults to a fixed cut. */
  styleDraw?: number;
  /** Held inputs. Climb/descend only mean something with altitude hold. */
  climb?: boolean;
  descend?: boolean;
  /** Throttle held: -1 slows the speed setting down, 1 speeds it up. */
  throttle?: -1 | 0 | 1;
  /** Draw in [0, 1): which event comes next, and its details. */
  eventDraw?: number;
};

/** Longest distance anything may move in one sub-step, so a fast run cannot tunnel through steel. */
const MAX_STEP_TRAVEL = 6;

export function stepGame(state: GameState, input: StepInput): GameState {
  if (state.status !== "flying") return state;

  // Clamp the timestep. A backgrounded tab resumes with a huge dt, and
  // un-clamped that teleports the drone past an obstacle without a collision
  // ever being tested.
  const dt = Math.min(Math.max(input.dt, 0), 0.05);

  // At ATTI speeds one frame can carry an obstacle further than the cage is
  // wide; split the step so every contact is still tested.
  const travel = Math.max(Math.abs(state.speed) + state.recoil, Math.abs(state.velocity), MAX_FALL_SPEED) * dt;
  const steps = Math.min(8, Math.max(1, Math.ceil(travel / MAX_STEP_TRAVEL)));
  // Keep just enough input history for a weak link to deliver it late.
  const logged: LoggedInput = {
    at: state.elapsed,
    climb: !!input.climb,
    descend: !!input.descend,
    throttle: input.throttle ?? 0,
  };
  const inputLog = state.events
    ? [...state.inputLog, logged].filter((e) => e.at >= state.elapsed - SIGNAL_LAG - 0.25)
    : state.inputLog;

  let s: GameState = { ...state, inputLog };
  let bump: Impact | null = null;
  for (let i = 0; i < steps && s.status === "flying"; i += 1) {
    s = subStep(s, input, dt / steps);
    bump ??= s.bump;
  }
  return { ...s, bump };
}

/** What the aircraft actually receives: over a weak link, what the pilot did a moment ago. */
function receivedInput(state: GameState, input: StepInput): Pick<StepInput, "climb" | "descend" | "throttle"> {
  const e = state.event;
  const lagging = !!e && e.kind === "SIGNAL" && (e.phase === "active" || e.phase === "lost");
  if (!lagging) return input;
  let late: LoggedInput | undefined;
  for (const entry of state.inputLog) if (entry.at <= state.elapsed - SIGNAL_LAG) late = entry;
  return late ?? { climb: false, descend: false, throttle: 0 };
}

function subStep(state: GameState, input: StepInput, dt: number): GameState {
  const spec = MODE_SPECS[state.mode];
  const event = state.event;
  // Return-to-Signal: the aircraft flies itself back, holding its height, and
  // the sticks do nothing until it has.
  const returning = event?.kind === "SIGNAL" && event.phase === "rts";
  const sticks = returning ? { climb: false, descend: false, throttle: 0 as const } : receivedInput(state, input);
  const assisted = state.mode === "ASSIST" || state.mode === "ASSIST_SPORT";

  let velocity: number;
  if (spec.altitudeHold || returning) {
    // Altitude hold: the aircraft climbs or descends at the rate asked for and
    // holds height when nothing is.
    const rate = spec.altitudeHold ? spec.climbRate : 0;
    const wanted = sticks.climb && !sticks.descend ? -rate : sticks.descend && !sticks.climb ? rate : 0;
    velocity = state.velocity + (wanted - state.velocity) * (1 - Math.exp(-dt / VERTICAL_TAU));
  } else {
    velocity = Math.min(state.velocity + GRAVITY * dt, MAX_FALL_SPEED);
  }
  // A draft: Assist leans into it and barely moves, ATTI drifts with it, and
  // ATTI MAN, holding nothing, is thrown about.
  if (isLive(event, "DRAFT") && event && !spec.altitudeHold && !returning) {
    velocity = Math.min(velocity + event.dir * DRAFT_MANUAL * dt, MAX_FALL_SPEED);
  }
  let y = state.y + velocity * dt;
  if (isLive(event, "DRAFT") && event && spec.altitudeHold) y += event.dir * (assisted ? DRAFT_ASSIST : DRAFT_ATTI) * dt;

  const elapsed = state.elapsed + dt;
  // Over featureless steel the cameras feed Assist a position that is not
  // there, and it jerks the aircraft about chasing it. ATTI ignores them.
  if (isLive(event, "FEATURELESS") && assisted) y += erraticJolt(elapsed) * dt;

  const target = clampTarget(state.mode, state.target + (sticks.throttle ?? 0) * THROTTLE_RATE * dt);
  // Forward speed heads for the setting; without position hold the air pushes it about too.
  let speed =
    state.speed + (target - state.speed) * (1 - Math.exp(-dt / spec.speedTau)) + gustAt(state.mode, elapsed) * dt;
  if (isLive(event, "FEATURELESS") && assisted) speed += 40 * Math.sin(3.1 * elapsed) * dt;
  speed = returning ? -RTS_SPEED : Math.max(0, speed);

  const decayed = state.recoil * Math.exp(-RECOIL_DECAY * dt);
  let recoil = decayed < 0.5 ? 0 : decayed;
  let obstacles = state.obstacles
    .map((o) => ({ ...o, x: o.x - worldSpeed({ speed, recoil }) * dt }))
    .filter((o) => o.x + o.width > -4);

  let { buildZone, buildCount, nextId } = state;
  const last = obstacles[obstacles.length - 1];
  if (!last || last.x + last.width <= WORLD_WIDTH - OBSTACLE_GAP) {
    let kind: ObstacleKind;
    if (buildCount >= ZONE_LENGTH) {
      // The space is done: seal it off and open the next one.
      buildZone = (buildZone + 1) % ZONES.length;
      buildCount = 0;
      kind = "BULKHEAD";
    } else {
      kind = kindFor(ZONES[buildZone], input.kindDraw, last?.kind);
      buildCount += 1;
    }
    const seed = seedFromDraw(input.styleDraw ?? 0.5);
    const built = buildObstacle(kind, input.placeDraw, seed);
    // While cables hang in this stretch, every gap gets one.
    const cable = event?.kind === "CABLES" ? 40 + detailDraw(input.placeDraw) * (MAX_CABLE - 40) : undefined;
    obstacles = [
      ...obstacles,
      { id: nextId, x: WORLD_WIDTH, kind, zone: buildZone, seed, passed: false, ...built, ...(cable ? { cable } : {}) },
    ];
    nextId += 1;
  }

  let score = state.score;
  let droneZone = state.droneZone;
  obstacles = obstacles.map((o) => {
    if (!o.passed && o.x + o.width < DRONE_X - DRONE_RADIUS) {
      score += 1;
      // Through the manhole: the drone is in the next space now.
      if (o.kind === "BULKHEAD") droneZone = o.zone;
      return { ...o, passed: true };
    }
    return o;
  });

  // ---- Events: what is happening to the aircraft, and what it does to the run.
  let ev = state.event;
  let { travelled, nextEventAt, heat, dose, lel, lidarOff } = state;
  let ended: Impact | null = null;
  if (state.events) {
    travelled += Math.max(0, speed) * dt;
    if (!ev) {
      if (travelled >= nextEventAt) {
        const kind = state.queued ?? pickEvent(ZONES[droneZone], score, input.eventDraw ?? 0.5);
        if (kind) ev = startEvent(kind, input.eventDraw ?? 0.5);
        else nextEventAt = travelled + 300;
      }
    } else {
      ev = { ...ev, t: ev.t + dt };
      if (ev.phase === "warning") {
        if (ev.t >= WARNING_TIME) ev = { ...ev, phase: "active", t: 0 };
      } else if (ev.phase === "active") {
        ev = { ...ev, left: ev.left - Math.max(0, speed) * dt };
        if (ev.kind === "SIGNAL" && ev.escalates && ev.left < EVENT_SPECS.SIGNAL.length / 2) {
          ev = { ...ev, phase: "lost", t: 0 };
        } else if (ev.left <= 0) {
          ev = null;
        }
      } else if (ev.phase === "lost") {
        if (ev.t >= LOST_TIME) ev = { ...ev, phase: "rts", t: 0 };
      } else if (ev.t >= RTS_TIME) {
        // Back in signal: the pilot has the sticks again, standing still.
        ev = null;
        speed = 0;
      }
      if (!ev) nextEventAt = travelled + eventGap(score);
    }

    heat = Math.min(1, Math.max(0, heat + (isLive(ev, "HEAT") ? dt / HEAT_TIME : -COOL_RATE * dt)));
    if (heat >= 1) lidarOff = true;
    else if (heat < LIDAR_RECOVER) lidarOff = false;
    dose = Math.min(1, Math.max(0, dose + (isLive(ev, "RADIATION") ? dt / DOSE_TIME : -DOSE_DECAY * dt)));
    const evacuating = isLive(ev, "GAS");
    lel = Math.min(1, Math.max(0, lel + (evacuating && speed < EVAC_SPEED ? dt / LEL_TIME : -LEL_FALL * dt)));
    if (dose >= 1) ended = { what: "RADIATION", x: DRONE_X, y };
    else if (lel >= 1) ended = { what: "GAS", x: DRONE_X, y };
  }

  // An event can take the current mode away; the switch drops to what still
  // works, and goes back to the pilot's choice once it passes.
  let mode = state.mode;
  let forcedFrom = state.forcedFrom;
  let held = target;
  const allowed = allowedModes({ event: ev, lidarOff });
  if (!allowed.includes(mode)) {
    forcedFrom ??= mode;
    mode = fallbackFrom(allowed);
    // Dropped into a mode that drifts, the aircraft is set a little inside
    // the cage rather than on its edge — the air would push it over at once.
    held = Math.min(clampTarget(mode, target), FORCED_SPEED);
  } else if (forcedFrom && forcedFrom !== mode && allowed.includes(forcedFrom)) {
    mode = forcedFrom;
    forcedFrom = null;
    held = clampTarget(mode, target);
  } else if (forcedFrom === mode) {
    forcedFrom = null;
  }

  let bump: Impact | null = null;
  if (isCollisionTolerant({ speed })) {
    const bounced = bounceOff(y, velocity, obstacles);
    ({ y, velocity, obstacles, bump } = bounced);
    if (bounced.headOn) {
      recoil = Math.max(recoil, BOUNCE_RECOIL);
      // A head-on hit stops the aircraft; it has to pick up speed again.
      speed = 0;
    }
  }

  // A cable snags whatever the speed: the cage bounces off steel, not rope.
  const impact = ended ?? cableAt(y, obstacles) ?? (bump ? null : contactAt(y, obstacles));
  const crashed = impact !== null;
  const flat = !crashed && elapsed >= BATTERY_SECONDS;

  return {
    status: crashed ? "crashed" : flat ? "landed" : "flying",
    // Park the drone inside the world rather than part-way through a wall.
    y: crashed ? Math.min(Math.max(y, DRONE_RADIUS), WORLD_HEIGHT - DRONE_RADIUS) : y,
    velocity,
    obstacles,
    score,
    elapsed: Math.min(elapsed, BATTERY_SECONDS),
    droneZone,
    buildZone,
    buildCount,
    nextId,
    impact,
    recoil: crashed ? 0 : recoil,
    bump,
    mode,
    speed: crashed ? 0 : speed,
    target: held,
    events: state.events,
    event: crashed ? null : ev,
    travelled,
    nextEventAt,
    heat,
    dose,
    lel,
    lidarOff,
    forcedFrom,
    inputLog: state.inputLog,
    queued: ev && ev.kind === state.queued ? null : state.queued,
  };
}

/** A cable the cage has caught, if any. */
function cableAt(y: number, obstacles: readonly Obstacle[]): Impact | null {
  for (const o of obstacles) {
    if (!o.cable) continue;
    const cx = gapX(o);
    if (Math.abs(cx - DRONE_X) > DRONE_RADIUS) continue;
    // The cage's lowest point on the cable's line, against the cable's end.
    const reach = Math.sqrt(Math.max(0, DRONE_RADIUS ** 2 - (cx - DRONE_X) ** 2));
    if (y - reach < o.cable) return { what: "CABLE", x: cx, y: Math.min(o.cable, y) };
  }
  return null;
}

/** What the cage is touching at height `y`, if anything — floor and ceiling first. */
function contactAt(y: number, obstacles: readonly Obstacle[]): Impact | null {
  if (hitsGround(y)) return { what: "FLOOR", x: DRONE_X, y: WORLD_HEIGHT };
  if (hitsCeiling(y)) return { what: "CEILING", x: DRONE_X, y: 0 };
  const hit = obstacles.find((o) => hitsObstacle(y, o));
  if (!hit) return null;
  const solid = hit.solids.find((s) => circleHitsSolid(DRONE_X, y, DRONE_RADIUS, s, hit.x)) ?? hit.solids[0];
  const [ix, iy] = nearestPointOnSolid(DRONE_X, y, solid, hit.x);
  return { what: hit.kind, x: ix, y: iy };
}

/** Clearance the cage is pushed out to after a bounce, so the next step starts free. */
const SEPARATION = 0.5;

/**
 * The collision-tolerant cage: push the drone clear of whatever it is touching
 * and send it back the way it came.
 *
 * The drone cannot move sideways — the world moves past it — so a push along x
 * is applied to the obstacles instead. Vertical speed into the surface is
 * reflected with `BOUNCE_RESTITUTION`; a hit on the front of something also
 * reports `headOn`, and the caller throws the world back with a recoil. A few
 * passes cover being wedged between two surfaces.
 */
function bounceOff(
  y0: number,
  v0: number,
  obstacles0: Obstacle[],
): { y: number; velocity: number; obstacles: Obstacle[]; bump: Impact | null; headOn: boolean } {
  let y = y0;
  let velocity = v0;
  let obstacles = obstacles0;
  let bump: Impact | null = null;
  let headOn = false;

  for (let pass = 0; pass < 4; pass += 1) {
    const contact = contactAt(y, obstacles);
    if (!contact) break;
    bump ??= contact;

    if (contact.what === "FLOOR") {
      y = WORLD_HEIGHT - DRONE_RADIUS - SEPARATION;
      velocity = -Math.abs(velocity) * BOUNCE_RESTITUTION;
      continue;
    }
    if (contact.what === "CEILING") {
      y = DRONE_RADIUS + SEPARATION;
      velocity = Math.abs(velocity) * BOUNCE_RESTITUTION;
      continue;
    }

    // Normal from the contact point to the cage's centre. A centre already
    // inside the steel has no usable normal; back straight out of it.
    const dx = DRONE_X - contact.x;
    const dy = y - contact.y;
    const d = Math.hypot(dx, dy);
    const [nx, ny, depth] = d > 1e-6 ? [dx / d, dy / d, DRONE_RADIUS - d] : [-1, 0, DRONE_RADIUS];
    const push = depth + SEPARATION;

    y += ny * push;
    if (nx !== 0) obstacles = obstacles.map((o) => ({ ...o, x: o.x - nx * push }));
    if (ny * velocity < 0) velocity = -velocity * BOUNCE_RESTITUTION;
    if (nx < -0.5) headOn = true;
  }

  // A cage wedged into a corner can be pushed through the floor or ceiling by
  // the last pass; never leave it outside the world.
  y = Math.min(Math.max(y, DRONE_RADIUS + SEPARATION), WORLD_HEIGHT - DRONE_RADIUS - SEPARATION);
  return { y, velocity, obstacles, bump, headOn };
}

/**
 * Versioned with the rules: a best flown on an older speed curve is not
 * comparable, so a rules change starts every browser's best afresh.
 */
export const BEST_SCORE_KEY = "rolegate:elios-best-v2";

export function isNewBest(score: number, best: number | null): boolean {
  return score > 0 && (best === null || score > best);
}

/** Anything that is not a sane count is treated as no score. */
export function parseStoredBest(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** A line for the crash screen, in the register of the screen around it. */
export function crashLine(score: number): string {
  if (score === 0) return "Straight into it. It happens.";
  if (score < 3) return "A short inspection.";
  if (score < 8) return "Solid flying.";
  if (score < 15) return "That is real pilot territory.";
  return "Show-off.";
}
