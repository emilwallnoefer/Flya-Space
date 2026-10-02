import { describe, expect, it } from "vitest";
import {
  DRONE_X,
  FLIGHT_MODES,
  INSPECT_TIME,
  MODE_SPECS,
  OBSTACLE_GAP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  ZONE_KINDS,
  activeDenial,
  allowedModes,
  buildObstacle,
  createMission,
  flap,
  poiX,
  seedFromDraw,
  setMode,
  stepGame,
  type GameState,
  type StepInput,
} from "@/lib/elios-flight";
import {
  MISSIONS,
  RESERVE,
  buildPlan,
  isUnlocked,
  missionStars,
  nextMission,
  parseProgress,
  recordStars,
} from "@/lib/elios-missions";

const INPUT: StepInput = { dt: 1 / 60, kindDraw: 0.3, placeDraw: 0.3, styleDraw: 0.3 };

/** Fly with nobody on the sticks through steel that is not there: just the course going past. */
function ghost(state: GameState, frames: number): GameState {
  let s = state;
  for (let i = 0; i < frames && s.status === "flying"; i += 1) {
    s = stepGame({ ...s, obstacles: s.obstacles.map((o) => ({ ...o, solids: [] })) }, INPUT);
  }
  return s;
}

describe("the missions", () => {
  it("are well formed", () => {
    const ids = new Set<string>();
    for (const m of MISSIONS) {
      expect(ids.has(m.id), m.id).toBe(false);
      ids.add(m.id);
      expect(m.modes).toContain(m.startMode);
      const plan = buildPlan(m);
      // Every inspection point sits in a gap the drone actually flies, never after the exit.
      for (const i of m.pois) expect(i, m.id).toBeLessThan(plan.course.length - 1);
      // Dust never takes away every mode the job allows.
      for (const d of m.denials) expect(m.modes.filter((x) => !d.modes.includes(x)).length, m.id).toBeGreaterThan(0);
      // Spaces follow the order the bulkheads join them in.
      m.spaces.forEach((s, i) => {
        if (i === 0) return;
        const prev = ZONES.indexOf(m.spaces[i - 1].zone);
        expect(ZONES.indexOf(s.zone), m.id).toBe((prev + 1) % ZONES.length);
      });
    }
  });

  it("bring the modes in the order a pilot meets them", () => {
    const debut = FLIGHT_MODES.map((mode) => MISSIONS.findIndex((m) => m.modes.includes(mode)));
    expect(debut.every((i) => i >= 0)).toBe(true);
    for (let k = 1; k < debut.length; k += 1) expect(debut[k]).toBeGreaterThan(debut[k - 1]);
  });

  it("draw the same course every attempt", () => {
    for (const m of MISSIONS) expect(buildPlan(m)).toEqual(buildPlan(m));
  });

  it("build each space from its own kinds, a bulkhead between, and the exit last", () => {
    for (const m of MISSIONS) {
      const plan = buildPlan(m);
      let i = 0;
      for (const space of m.spaces) {
        for (let k = 0; k < space.count; k += 1, i += 1) expect(ZONE_KINDS[space.zone]).toContain(plan.course[i].kind);
        expect(plan.course[i].kind).toBe("BULKHEAD");
        i += 1;
      }
      expect(i).toBe(plan.course.length);
      expect(plan.pois).toBe(plan.course.filter((c) => c.poi !== null).length);
    }
  });

  it("can be flown out with the reserve, at the fastest the job allows", () => {
    // Course length over top speed, plus the time each inspection costs.
    for (const m of MISSIONS) {
      const plan = buildPlan(m);
      let units = WORLD_WIDTH - DRONE_X;
      for (const c of plan.course) units += buildObstacle(c.kind, c.place, seedFromDraw(c.style)).width + OBSTACLE_GAP;
      const top = Math.max(...m.modes.map((x) => Math.min(MODE_SPECS[x].maxSpeed, MODE_SPECS.ATTI_SPORT.maxSpeed)));
      const seconds = units / top + plan.pois * (INSPECT_TIME + 0.6);
      expect(seconds, m.id).toBeLessThan(plan.battery * (1 - RESERVE));
    }
  });

  it("cannot be flown out with the reserve in Assist Sport alone where the brief says so", () => {
    const plan = buildPlan(MISSIONS.find((m) => m.id === "long-sewer")!);
    let units = WORLD_WIDTH - DRONE_X;
    for (const c of plan.course) units += buildObstacle(c.kind, c.place, seedFromDraw(c.style)).width + OBSTACLE_GAP;
    expect(units / MODE_SPECS.ASSIST_SPORT.maxSpeed).toBeGreaterThan(plan.battery * (1 - RESERVE));
  });
});

describe("flying a mission", () => {
  const plan = buildPlan(MISSIONS[0]);

  it("starts in the mission's first space and mode, and launches on a press", () => {
    const s = createMission(plan);
    expect(s.status).toBe("idle");
    expect(s.mode).toBe("ASSIST");
    expect(s.droneZone).toBe(ZONES.indexOf("BOILER"));
    expect(flap(s).status).toBe("flying");
  });

  it("builds the course it was given, in order, and nothing after the exit", () => {
    const s = ghost(flap(createMission(plan)), 60 * 60);
    expect(s.status).toBe("complete");
    expect(s.nextId - 1).toBe(plan.course.length);
    expect(s.score).toBe(plan.course.length);
  });

  it("refuses a mode the job does not allow", () => {
    const s = flap(createMission(plan));
    expect(setMode(s, "ATTI")).toBe(s);
    expect(allowedModes(s)).toEqual(["ASSIST"]);
  });

  it("inspects a point the drone lingers by, and not one it races past", () => {
    const base = flap(createMission(plan));
    const o = { ...base.obstacles[0], id: 99, x: 0, kind: "PLATEN" as const, zone: 0, seed: 1, passed: true, width: 10, solids: [] };
    const placed = (speed: number): GameState => ({
      ...base,
      y: 100,
      speed,
      target: speed,
      obstacles: [{ ...o, x: DRONE_X + 30 - (10 + OBSTACLE_GAP / 2), poi: { y: 100, dwell: 0, done: false } }],
    });
    expect(poiX(placed(0).obstacles[0])).toBeCloseTo(DRONE_X + 30, 6);
    const slow = ghost(placed(40), 120);
    expect(slow.inspected).toBe(1);
    const fast = ghost(placed(200), 120);
    expect(fast.inspected).toBe(0);
  });

  it("ends on a flat battery short of the exit, with no stars", () => {
    const s = ghost({ ...flap(createMission(plan)), elapsed: plan.battery - 0.1 }, 30);
    expect(s.status).toBe("landed");
    expect(missionStars(s)).toBe(0);
  });

  it("drops out of Assist in the dust, and lets the pilot back in after it", () => {
    const dusty = buildPlan(MISSIONS.find((m) => m.id === "dusty-stope")!);
    const s = { ...flap(createMission(dusty)), y: WORLD_HEIGHT / 2 };
    const inDust = stepGame({ ...s, score: 3 }, INPUT);
    expect(activeDenial(inDust)?.reason).toMatch(/dust/i);
    expect(inDust.mode).toBe("ATTI");
    expect(setMode(inDust, "ASSIST")).toBe(inDust);
    const out = { ...inDust, score: 7 };
    expect(activeDenial(out)).toBeNull();
    expect(setMode(out, "ASSIST").mode).toBe("ASSIST");
  });
});

describe("stars and progress", () => {
  const plan = buildPlan(MISSIONS[1]);
  const done = (over: Partial<GameState>): GameState => ({ ...createMission(plan), status: "complete", ...over });

  it("gives one for the exit, one for every point, one for the reserve", () => {
    expect(missionStars(done({ inspected: 0, elapsed: plan.battery }))).toBe(1);
    expect(missionStars(done({ inspected: plan.pois, elapsed: plan.battery }))).toBe(2);
    expect(missionStars(done({ inspected: plan.pois, elapsed: 0 }))).toBe(3);
    expect(missionStars(done({ inspected: 0, elapsed: 0 }))).toBe(2);
    expect(missionStars({ ...done({}), status: "crashed" })).toBe(0);
  });

  it("keeps the best result and never loses a star", () => {
    const p = recordStars({}, "first-look", 2);
    expect(recordStars(p, "first-look", 1)).toBe(p);
    expect(recordStars(p, "first-look", 3)["first-look"]).toBe(3);
  });

  it("opens each mission once the one before is flown out", () => {
    expect(isUnlocked(0, {})).toBe(true);
    expect(isUnlocked(1, {})).toBe(false);
    expect(isUnlocked(1, { "first-look": 1 })).toBe(true);
    expect(nextMission({})).toBe(0);
    expect(nextMission({ "first-look": 3 })).toBe(1);
    const all = Object.fromEntries(MISSIONS.map((m) => [m.id, 3]));
    expect(nextMission(all)).toBe(MISSIONS.length - 1);
  });

  it("treats junk in storage as no progress", () => {
    for (const raw of [null, "", "x", "[]", "3", '{"first-look":7}', '{"first-look":"3"}']) {
      expect(parseProgress(raw)).toEqual({});
    }
    expect(parseProgress('{"first-look":2,"nope":3}')).toEqual({ "first-look": 2 });
  });
});
