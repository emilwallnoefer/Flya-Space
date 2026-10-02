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
 * The space decides how the aircraft flies (`ZONE_MODE`): Assist in tight
 * spaces, ATTI in open voids, and dust forces ATTI anywhere. Contact is a
 * crash — there is no cage to bounce off — and the pace rises with every
 * obstacle cleared (`speedFor`). The obstacle spacing is unchanged from the
 * first version of the game; changing any of this changes what a score
 * means, so it comes with a leaderboard reset and a bump of
 * `ELIOS_RULES_VERSION`.
 */

import {
  DOSE_DECAY,
  DOSE_TIME,
  EVENT_SPECS,
  FIRST_EVENT,
  LEL_FALL,
  LEL_TIME,
  RTS_SPEED,
  RTS_TIME,
  SIGNAL_LAG,
  WARNING_TIME,
  detailDraw,
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
 * How the Elios flies is not the pilot's choice: it is what the space allows.
 *
 *   Assist       tight, feature-rich spaces — boiler, ballast tank, sewer.
 *                The cameras and lidar hold the aircraft: it goes exactly
 *                where it is told and hovers when nothing is pressed.
 *   ATTI         big open voids — the stope, the storage tank — where the
 *                walls are beyond the sensors' range. Only altitude is held:
 *                the aircraft has momentum, wanders, and drafts throw it.
 *   Forced ATTI  dust blinds the sensors in an Assist space, and the aircraft
 *                drops to ATTI without being asked — the real FORCED ATTI.
 *
 * The controls never change: hold up to climb, down to descend, in all three.
 * What changes is how well the aircraft does what it is told.
 *
 * There is no cage to save you: contact is a crash. And the run does not wait
 * — it starts at 1.5 m/s and gets faster with every obstacle cleared.
 */
export type FlightMode = "ASSIST" | "ATTI" | "FORCED_ATTI";

/** Which mode each space flies in, before any event has its say. */
export const ZONE_MODE: Record<Zone, "ASSIST" | "ATTI"> = {
  BOILER: "ASSIST",
  BALLAST: "ASSIST",
  MINE: "ATTI",
  SEWER: "ASSIST",
  TANK: "ATTI",
};

/**
 * `climb` is the vertical rate up or down asks for, `tau` how long the
 * aircraft takes to get there (ATTI has momentum), `wander` how far a drone
 * holding only altitude drifts up and down on its own, `draft` how hard a
 * draft carries it, and `gust` how much the air pushes its forward speed.
 */
export const MODE_SPECS: Record<
  FlightMode,
  { label: string; why: string; climb: number; tau: number; wander: number; draft: number; gust: number }
> = {
  ASSIST: { label: "Assist", why: "Stabilised", climb: 110, tau: 0.12, wander: 0, draft: 10, gust: 0 },
  ATTI: { label: "ATTI", why: "Open void — beyond sensor range", climb: 130, tau: 0.4, wander: 26, draft: 70, gust: 18 },
  FORCED_ATTI: { label: "Forced ATTI", why: "Sensors blinded", climb: 130, tau: 0.4, wander: 26, draft: 70, gust: 18 },
};

const mps = (metres: number) => metres / METRES_PER_UNIT;

/**
 * The run speeds up as it goes: 1.5 m/s at the start, +0.03 m/s for every
 * obstacle cleared, up to 4.5 m/s about 100 obstacles in — fast enough to be
 * hard, slow enough that ATTI's drift stays flyable. Obstacles stay the same
 * distance apart, so only the time to read one shrinks. The cap is held down
 * by the double web frame, whose second hole has to stay reachable at the
 * fastest the run gets (the test suite checks it).
 */
export const START_SPEED = mps(1.5);
export const SPEED_PER_OBSTACLE = mps(0.03);
export const MAX_SPEED = mps(4.5);
/** How quickly the forward speed settles on a new pace. */
export const SPEED_TAU = 0.8;

export function speedFor(cleared: number): number {
  const n = Number.isFinite(cleared) ? Math.max(0, cleared) : 0;
  return Math.min(MAX_SPEED, START_SPEED + SPEED_PER_OBSTACLE * n);
}

/**
 * The pick-ups: what the real aircraft can do for a pilot in trouble.
 *
 * - Repeat Flight: the Elios 3 can fly a recorded path again by itself. Here
 *   it takes over for `AUTO_TIME` seconds, threads every obstacle on its own,
 *   and cannot crash while it does.
 * - Dust-proof light: the lighting mode that stops dust throwing the light
 *   back into the camera. Here it clears dust and darkness from the picture
 *   for `LIGHT_TIME` seconds — the picture, not the sensors.
 */
export const PICKUPS = ["REPEAT", "LIGHT"] as const;
export type PickupKind = (typeof PICKUPS)[number];
export const AUTO_TIME = 4;
export const LIGHT_TIME = 6;
/** How close the cage has to come to a pick-up to collect it. */
export const PICKUP_REACH = DRONE_RADIUS + 7;
/** Obstacles between pick-ups: at least this many, plus up to `PICKUP_SPREAD` more. */
export const PICKUP_EVERY = 9;
export const PICKUP_SPREAD = 7;

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

/** How fast the obstacles are moving: the forward speed. Negative while Return-to-Signal flies back. */
export function worldSpeed(state: Pick<GameState, "speed">): number {
  return state.speed;
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
  /** A cable hanging from the roof in the gap behind this obstacle. */
  cable?: Cable;
  /** The middle of the widest way through, for the autopilot. */
  lane?: number;
  /** A pick-up floating in the gap behind this obstacle. */
  pickup?: Pickup;
};

export type Pickup = { kind: PickupKind; y: number; taken: boolean };

/**
 * A cable hanging from the roof: a pendulum, `length` long, swinging at
 * `angle` radians from straight down (positive swings toward the drone's
 * side, which is behind it) with angular speed `spin`. The drone's own
 * downwash pulls a nearby cable toward it — the way a loose line gets sucked
 * into a real drone's propellers.
 */
export type Cable = { length: number; angle: number; spin: number };

/** Where a cable's free end is, in world units. */
export function cableTip(o: Pick<Obstacle, "x" | "width">, cable: Cable): Vec {
  return [gapX(o) - Math.sin(cable.angle) * cable.length, Math.cos(cable.angle) * cable.length];
}

/** How strongly gravity swings a cable back (world units per second squared), and how quickly a swing dies. */
export const CABLE_GRAVITY = 700;
export const CABLE_DAMPING = 0.7;
/** The downwash reaches this far from the drone's centre, and pulls this hard right underneath it. */
export const SUCTION_REACH = 46;
export const SUCTION = 900;

/** One step of a cable's swing, with the drone's downwash pulling at it. */
export function swingCable(o: Pick<Obstacle, "x" | "width">, cable: Cable, droneY: number, dt: number): Cable {
  const [tx, ty] = cableTip(o, cable);
  // Gravity pulls the end back under the anchor.
  let alpha = -(CABLE_GRAVITY / cable.length) * Math.sin(cable.angle) - CABLE_DAMPING * cable.spin;
  // The downwash: a pull on the end toward the drone, fading out to its reach.
  const dx = DRONE_X - tx;
  const dy = droneY - ty;
  const d = Math.hypot(dx, dy);
  if (d < SUCTION_REACH && d > 1e-6) {
    const pull = SUCTION * (1 - d / SUCTION_REACH);
    // Only the part of the pull along the arc swings it; the cable takes the rest.
    const along = (dx / d) * -Math.cos(cable.angle) + (dy / d) * -Math.sin(cable.angle);
    alpha += (pull * along) / cable.length;
  }
  const spin = cable.spin + alpha * dt;
  const angle = Math.max(-1.3, Math.min(1.3, cable.angle + spin * dt));
  return { ...cable, angle, spin };
}

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

export type GameStatus = "idle" | "flying" | "crashed";

/** Where a run ended and what it ended on — the crash screen names it. */
export type Impact = { what: ImpactKind; x: number; y: number };

export type GameState = {
  status: GameStatus;
  /** Vertical position of the drone's centre. */
  y: number;
  velocity: number;
  obstacles: Obstacle[];
  /** Obstacles cleared. It is the score, and it sets the pace. */
  score: number;
  /** Seconds elapsed this run; drives the drift and the animation. */
  elapsed: number;
  /** Index into ZONES of the space the drone is flying in right now. */
  droneZone: number;
  /** Index into ZONES of the space new obstacles are being built for. */
  buildZone: number;
  /** Obstacles built so far in `buildZone`; at ZONE_LENGTH a bulkhead follows. */
  buildCount: number;
  nextId: number;
  impact: Impact | null;
  /** Forward speed over the ground, world units per second. What the readout shows. */
  speed: number;
  /** Whether things happen to the aircraft on this run (see `elios-events.ts`), and pick-ups appear. */
  events: boolean;
  event: ActiveEvent | null;
  /** World units flown forward this run; events are spaced in it. */
  travelled: number;
  nextEventAt: number;
  /** Meters, 0 to 1: radiation dose, gas concentration. */
  dose: number;
  lel: number;
  /** Recent inputs, so a weak link can deliver them late. */
  inputLog: readonly LoggedInput[];
  /** An event that comes next whatever the space — for trying one out. */
  queued: EventKind | null;
  /** Seconds of Repeat Flight left; the autopilot has the aircraft while above zero. */
  auto: number;
  /** Seconds of dust-proof light left. */
  light: number;
  /** Id of the obstacle the next pick-up is built on. */
  nextPickupAt: number;
  /** Seconds left of shaking off a rope caught in the motors; the sticks do nothing meanwhile. */
  stun: number;
  /** The rope the drone caught this step and is recovering from; null on a clean step. */
  bump: Impact | null;
};

type LoggedInput = { at: number; climb: boolean; descend: boolean };

export function createGame(startZone = 0, events = false): GameState {
  const zone = ZONES.indexOf(zoneAt(startZone));
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
    // A run launches already cruising rather than from a standstill.
    speed: START_SPEED,
    events,
    event: null,
    travelled: 0,
    nextEventAt: FIRST_EVENT,
    dose: 0,
    lel: 0,
    inputLog: [],
    queued: null,
    auto: 0,
    light: 0,
    nextPickupAt: PICKUP_EVERY,
    stun: 0,
    bump: null,
  };
}

/** How the aircraft is flying right now: the space decides, and dust can force ATTI. */
export function modeOf(state: Pick<GameState, "droneZone" | "event">): FlightMode {
  if (ZONE_MODE[zoneAt(state.droneZone)] === "ATTI") return "ATTI";
  return isLive(state.event, "DUST") ? "FORCED_ATTI" : "ASSIST";
}

/** A smooth, repeatable wander in [-1, 1] — the air a drone holding only altitude drifts in. */
function wander(t: number, phase: number): number {
  return (Math.sin(0.9 * t + phase) + 0.6 * Math.sin(2.3 * t + 1.1 + phase) + 0.3 * Math.sin(5.1 * t + phase)) / 1.9;
}

/** The push on the forward speed in this mode, world units per second per second. */
export function gustAt(mode: FlightMode, elapsed: number): number {
  const g = MODE_SPECS[mode].gust;
  if (g === 0) return 0;
  return g * wander(Number.isFinite(elapsed) ? elapsed : 0, 0.4);
}

/** A press from `idle` launches the run; everything after it is held input to `stepGame`. */
export function flap(state: GameState): GameState {
  return state.status === "idle" ? { ...state, status: "flying" } : state;
}

export type StepInput = {
  /** Seconds since the last step. */
  dt: number;
  /** Draws in [0, 1): which kind of obstacle, and where its opening sits. */
  kindDraw: number;
  placeDraw: number;
  /** Draw in [0, 1) that cuts ragged shapes; defaults to a fixed cut. */
  styleDraw?: number;
  /** Held inputs: up climbs, down descends, in every mode. */
  climb?: boolean;
  descend?: boolean;
  /** Draw in [0, 1): which event comes next, and its details; also where pick-ups go. */
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

  // At top speed one frame can carry an obstacle further than the cage is
  // wide; split the step so every contact is still tested.
  const travel = Math.max(Math.abs(state.speed), Math.abs(state.velocity), MAX_FALL_SPEED) * dt;
  const steps = Math.min(8, Math.max(1, Math.ceil(travel / MAX_STEP_TRAVEL)));
  // Keep just enough input history for a weak link to deliver it late.
  const logged: LoggedInput = { at: state.elapsed, climb: !!input.climb, descend: !!input.descend };
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
function receivedInput(state: GameState, input: StepInput): Pick<StepInput, "climb" | "descend"> {
  const e = state.event;
  const lagging = !!e && e.kind === "SIGNAL" && e.phase === "active";
  if (!lagging) return input;
  let late: LoggedInput | undefined;
  for (const entry of state.inputLog) if (entry.at <= state.elapsed - SIGNAL_LAG) late = entry;
  return late ?? { climb: false, descend: false };
}

/**
 * The middle of the widest way through an obstacle, measured with it centred
 * on the drone: where the Repeat Flight autopilot steers.
 */
export function laneThrough(solids: readonly Solid[], width: number): number {
  const x = DRONE_X - width / 2;
  let best: [number, number] = [WORLD_HEIGHT / 2, WORLD_HEIGHT / 2];
  let start: number | null = null;
  for (let y = DRONE_RADIUS + 1; y <= WORLD_HEIGHT - DRONE_RADIUS - 1; y += 2) {
    const free = !solids.some((s) => circleHitsSolid(DRONE_X, y, DRONE_RADIUS, s, x));
    if (free && start === null) start = y;
    if ((!free || y + 2 > WORLD_HEIGHT - DRONE_RADIUS - 1) && start !== null) {
      const end = free ? y : y - 2;
      if (end - start > best[1] - best[0]) best = [start, end];
      start = null;
    }
  }
  return (best[0] + best[1]) / 2;
}

/** Height of a gas layer: methane gathers under the roof, hydrogen sulphide on the floor. */
export const GAS_LAYER = 64;
/** How far from the hot band radiation still adds to the dose. */
export const RADIATION_REACH = 80;

/** Is the drone in the gas layer an event has laid down? */
export function inGas(event: ActiveEvent | null, y: number): boolean {
  if (!isLive(event, "GAS") || !event) return false;
  return event.dir < 0 ? y - DRONE_RADIUS < GAS_LAYER : y + DRONE_RADIUS > WORLD_HEIGHT - GAS_LAYER;
}

/** Where a radiation event's hot band runs, as a height. */
export function radiationBand(event: Pick<ActiveEvent, "dir">): number {
  return event.dir < 0 ? WORLD_HEIGHT * 0.3 : WORLD_HEIGHT * 0.7;
}

/** Dose per second at height `y`: strongest on the band, nothing beyond its reach. */
export function doseRate(event: ActiveEvent | null, y: number): number {
  if (!isLive(event, "RADIATION") || !event) return 0;
  const near = Math.max(0, 1 - Math.abs(y - radiationBand(event)) / RADIATION_REACH);
  return (near * near) / DOSE_TIME;
}

function subStep(state: GameState, input: StepInput, dt: number): GameState {
  const event = state.event;
  const mode = modeOf(state);
  const spec = MODE_SPECS[mode];
  const autopilot = state.auto > 0;
  // Return-to-Signal: the aircraft retraces its own path, holding its height,
  // and the sticks do nothing until it is back in signal. Repeat Flight outranks it.
  const returning = !autopilot && event?.kind === "SIGNAL" && event.phase === "rts";
  const flownForYou = autopilot || returning;
  const sticks = returning ? { climb: false, descend: false } : receivedInput(state, input);
  const elapsed = state.elapsed + dt;

  // ---- Up and down.
  let velocity: number;
  if (autopilot) {
    // Repeat Flight: steer for the way through whatever is next.
    const next = state.obstacles.find((o) => o.x + o.width > DRONE_X - DRONE_RADIUS);
    const lane = next?.lane ?? WORLD_HEIGHT / 2;
    velocity = Math.max(-170, Math.min(170, (lane - state.y) * 7));
  } else if (state.stun > 0) {
    // A rope in the motors: the aircraft sinks while it sheds it.
    velocity = state.velocity + (KNOCK_DROP - state.velocity) * (1 - Math.exp(-dt / 0.1));
  } else {
    // Altitude hold in every mode: up and down ask for a climb rate, nothing
    // asks to stay. ATTI gets there slowly and wanders on its own; a draft
    // carries ATTI and barely moves Assist.
    const rate = returning ? 0 : spec.climb;
    const wanted = sticks.climb && !sticks.descend ? -rate : sticks.descend && !sticks.climb ? rate : 0;
    const draft = isLive(event, "DRAFT") && event && !returning ? event.dir * spec.draft : 0;
    const drift = returning ? 0 : spec.wander * wander(elapsed, 2.7);
    velocity = state.velocity + (wanted + draft + drift - state.velocity) * (1 - Math.exp(-dt / spec.tau));
  }
  let y = state.y + velocity * dt;

  // ---- Forward: the pace of the run, pushed about by the air in ATTI.
  let speed = state.speed + (speedFor(state.score) - state.speed) * (1 - Math.exp(-dt / SPEED_TAU));
  if (!flownForYou) speed += gustAt(mode, elapsed) * dt;
  speed = returning ? -RTS_SPEED : Math.max(0, speed);

  let obstacles = state.obstacles
    .map((o) => {
      const moved = { ...o, x: o.x - speed * dt };
      return o.cable ? { ...moved, cable: swingCable(moved, o.cable, state.y, dt) } : moved;
    })
    .filter((o) => o.x + o.width > -4);

  // ---- New obstacles, with what the run is putting in the gaps.
  let { buildZone, buildCount, nextId, nextPickupAt } = state;
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
    const draw = input.eventDraw ?? 0.5;
    // While cables hang in this stretch, every gap gets one.
    const cable: Cable | undefined =
      event?.kind === "CABLES"
        ? { length: 40 + detailDraw(input.placeDraw) * (MAX_CABLE - 40), angle: 0, spin: (detailDraw(draw) - 0.5) * 1.2 }
        : undefined;
    let pickup: Pickup | undefined;
    if (state.events && nextId >= nextPickupAt && !cable) {
      pickup = { kind: draw < 0.6 ? "REPEAT" : "LIGHT", y: 50 + detailDraw(draw) * 100, taken: false };
      nextPickupAt = nextId + PICKUP_EVERY + Math.floor(detailDraw(detailDraw(draw)) * PICKUP_SPREAD);
    }
    obstacles = [
      ...obstacles,
      {
        id: nextId,
        x: WORLD_WIDTH,
        kind,
        zone: buildZone,
        seed,
        passed: false,
        ...built,
        lane: laneThrough(built.solids, built.width),
        ...(cable ? { cable } : {}),
        ...(pickup ? { pickup } : {}),
      },
    ];
    nextId += 1;
  }

  // ---- Scoring, and pick-ups collected on the way past.
  let { score, auto, light } = state;
  let droneZone = state.droneZone;
  auto = Math.max(0, auto - dt);
  light = Math.max(0, light - dt);
  obstacles = obstacles.map((o) => {
    let next = o;
    if (!o.passed && o.x + o.width < DRONE_X - DRONE_RADIUS) {
      score += 1;
      // Through the manhole: the drone is in the next space now.
      if (o.kind === "BULKHEAD") droneZone = o.zone;
      next = { ...next, passed: true };
    }
    const p = o.pickup;
    if (p && !p.taken && Math.hypot(gapX(o) - DRONE_X, p.y - y) <= PICKUP_REACH) {
      if (p.kind === "REPEAT") auto = AUTO_TIME;
      else light = LIGHT_TIME;
      next = { ...next, pickup: { ...p, taken: true } };
    }
    return next;
  });

  // ---- Events: what is happening to the aircraft, and what it does to the run.
  let ev = state.event;
  let { travelled, nextEventAt, dose, lel } = state;
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
        // The link drops out entirely, and the aircraft starts flying itself
        // back the same instant — no countdown to watch on a black screen.
        if (ev.kind === "SIGNAL" && ev.escalates && ev.left < EVENT_SPECS.SIGNAL.length / 2) {
          ev = { ...ev, phase: "rts", t: 0 };
        } else if (ev.left <= 0) {
          ev = null;
        }
      } else if (ev.t >= RTS_TIME) {
        // Back in signal: the pilot has the sticks again, standing still.
        ev = null;
        speed = 0;
      }
      if (!ev) nextEventAt = travelled + eventGap(score);
    }

    dose = Math.min(1, Math.max(0, dose + (doseRate(ev, y) > 0 ? doseRate(ev, y) * dt : -DOSE_DECAY * dt)));
    lel = Math.min(1, Math.max(0, lel + (inGas(ev, y) ? dt / LEL_TIME : -LEL_FALL * dt)));
    if (dose >= 1) ended = { what: "RADIATION", x: DRONE_X, y };
    else if (lel >= 1) ended = { what: "GAS", x: DRONE_X, y };
  }

  // ---- Contact. Steel, the roof or the floor ends the run there and then.
  // A cable is the one thing it survives: the rope wraps the motors, the
  // drone drops and wobbles while it sheds it, and then flies on.
  // Repeat Flight and Return-to-Signal fly a safe path, so only stay inside the world.
  let impact: Impact | null = ended;
  let bump: Impact | null = null;
  let stun = Math.max(0, state.stun - dt);
  if (flownForYou) {
    y = Math.min(Math.max(y, DRONE_RADIUS + 1), WORLD_HEIGHT - DRONE_RADIUS - 1);
  } else if (!impact) {
    impact = contactAt(y, obstacles);
    if (!impact) {
      const tangled = obstacles.find((o) => cableAt(y, [o]) !== null);
      if (tangled) {
        bump = cableAt(y, [tangled]);
        velocity = KNOCK_DROP;
        stun = KNOCK_TIME;
        // It loses its way forward too, and has to pick the pace back up.
        speed *= KNOCK_SPEED;
        // Shaken off: that rope is gone, so it cannot catch the drone twice.
        obstacles = obstacles.map((o) => (o === tangled ? { ...o, cable: undefined } : o));
      }
    }
  }
  const crashed = impact !== null;

  return {
    status: crashed ? "crashed" : "flying",
    // Park the drone inside the world rather than part-way through a wall.
    y: crashed ? Math.min(Math.max(y, DRONE_RADIUS), WORLD_HEIGHT - DRONE_RADIUS) : y,
    velocity,
    obstacles,
    score,
    elapsed,
    droneZone,
    buildZone,
    buildCount,
    nextId,
    impact,
    speed: crashed ? 0 : speed,
    events: state.events,
    event: crashed ? null : ev,
    travelled,
    nextEventAt,
    dose,
    lel,
    inputLog: state.inputLog,
    queued: ev && ev.kind === state.queued ? null : state.queued,
    auto,
    light,
    nextPickupAt,
    stun: crashed ? 0 : stun,
    bump,
  };
}

/** A drone with a rope in its motors: how fast it sinks, how long the sticks are dead, and how much forward speed it keeps. */
export const KNOCK_DROP = 85;
export const KNOCK_TIME = 0.45;
export const KNOCK_SPEED = 0.35;

/** A cable caught in the propellers, if any: anywhere along it, not just its end. */
export function cableAt(y: number, obstacles: readonly Pick<Obstacle, "x" | "width" | "cable">[]): Impact | null {
  for (const o of obstacles) {
    if (!o.cable) continue;
    const ax = gapX(o);
    const [tx, ty] = cableTip(o, o.cable);
    if (distanceToSegment(DRONE_X, y, ax, 0, tx, ty) < DRONE_RADIUS) return { what: "CABLE", x: tx, y: Math.min(ty, y) };
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
