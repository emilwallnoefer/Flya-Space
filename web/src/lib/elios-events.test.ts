import { describe, expect, it } from "vitest";
import {
  AUTO_TIME,
  DRONE_RADIUS,
  DRONE_X,
  GEAR_SPECS,
  LIGHT_TIME,
  MAX_CABLE,
  WORLD_HEIGHT,
  ZONES,
  buildObstacle,
  cancelRts,
  createGame,
  flap,
  gapX,
  handlingOf,
  shiftGear,
  stepGame,
  type Gear,
  type GameState,
  type Obstacle,
  type PickupKind,
  type StepInput,
} from "@/lib/elios-flight";
import {
  DRAFT_ATTI,
  EVAC_SPEED,
  EVENT_KINDS,
  EVENT_SPECS,
  FIRST_EVENT,
  LOST_TIME,
  RTS_TIME,
  WARNING_TIME,
  eventGap,
  pickEvent,
  startEvent,
  type ActiveEvent,
  type EventKind,
} from "@/lib/elios-events";

const INPUT: StepInput = { dt: 1 / 60, kindDraw: 0.3, placeDraw: 0.3, styleDraw: 0.3, eventDraw: 0.3 };

/** A run with events on, flying, mid-screen, no obstacles. */
function flying(gear: Gear, over: Partial<GameState> = {}): GameState {
  return { ...flap(createGame(0, gear, true)), y: WORLD_HEIGHT / 2, velocity: 0, ...over };
}

/** The same, with an event already biting and far from over. */
function inEvent(kind: EventKind, gear: Gear, over: Partial<GameState> = {}, event: Partial<ActiveEvent> = {}) {
  return flying(gear, { event: { ...startEvent(kind, 0.3), phase: "active", left: 1e6, ...event }, ...over });
}

/** Fly with no obstacles in the way: obstacles keep spawning, so strip their steel. */
function fly(state: GameState, frames: number, input: Partial<StepInput> = {}): GameState {
  let s = state;
  for (let i = 0; i < frames && s.status === "flying"; i += 1) {
    s = stepGame({ ...s, obstacles: s.obstacles.map((o) => ({ ...o, solids: [] })) }, { ...INPUT, ...input });
  }
  return s;
}

describe("the event list", () => {
  it("gives every event a code, a hint, somewhere to happen and a length", () => {
    for (const k of EVENT_KINDS) {
      const spec = EVENT_SPECS[k];
      expect(spec.code.length, k).toBeGreaterThan(0);
      expect(spec.hint.length, k).toBeGreaterThan(0);
      expect(spec.length, k).toBeGreaterThan(0);
      expect(spec.zones === "ANY" || spec.zones.length > 0, k).toBe(true);
    }
  });

  it("keeps the vocabulary small", () => {
    expect(EVENT_KINDS.length).toBeLessThanOrEqual(8);
  });

  it("can turn up in every space, and every event can turn up somewhere", () => {
    const seen = new Set<EventKind>();
    for (const zone of ZONES) {
      const here = new Set<EventKind>();
      for (let d = 0; d < 1; d += 0.01) {
        const k = pickEvent(zone, 100, d);
        if (k) {
          here.add(k);
          seen.add(k);
        }
      }
      expect(here.size, zone).toBeGreaterThan(2);
      // Something can happen from the very first event, wherever the run starts.
      expect(pickEvent(zone, 0, 0.5), zone).not.toBeNull();
    }
    expect(seen.size).toBe(EVENT_KINDS.length);
  });

  it("holds the nastier ones back until the run is under way", () => {
    for (let d = 0; d < 1; d += 0.01) {
      for (const zone of ZONES) {
        const k = pickEvent(zone, 0, d);
        if (k) expect(EVENT_SPECS[k].minScore, k).toBe(0);
      }
    }
  });

  it("comes closer together as the run goes on, down to a floor", () => {
    expect(eventGap(30)).toBeLessThan(eventGap(0));
    expect(eventGap(1e6)).toBe(450);
  });
});

describe("the event cycle", () => {
  it("is off unless the run asks for it", () => {
    const s = fly({ ...flap(createGame(0, "ASSIST_SPORT")), y: 100 }, 60 * 30);
    expect(s.event).toBeNull();
  });

  it("warns first, then bites, then ends after its length, then waits before the next", () => {
    let s = flying("ASSIST_SPORT", { travelled: FIRST_EVENT });
    s = fly(s, 1);
    expect(s.event?.phase).toBe("warning");
    s = fly(s, Math.ceil(WARNING_TIME * 60) + 1);
    expect(s.event?.phase).not.toBe("warning");
    for (let i = 0; i < 60 * 60 && s.event; i += 1) s = fly(s, 1);
    expect(s.event).toBeNull();
    expect(s.status).toBe("flying");
    expect(s.nextEventAt).toBeGreaterThan(s.travelled);
  });
});

describe("dust", () => {
  it("blinds an Assist gear into ATTI handling at its own speed, and gives it back after", () => {
    const s = fly(inEvent("DUST", "ASSIST_SPORT"), 1);
    expect(handlingOf(s)).toBe("ATTI");
    expect(s.gear).toBe("ASSIST_SPORT");
    expect(s.speed).toBeLessThan(GEAR_SPECS.ASSIST_SPORT.speed + 5);
    expect(handlingOf({ ...s, event: null })).toBe("ASSIST");
  });

  it("leaves Assist inside the cage through the drift, but pushes Assist Sport out of it at times", () => {
    const peak = (gear: Gear) => {
      let s = inEvent("DUST", gear);
      let top = 0;
      for (let i = 0; i < 60 * 10; i += 1) {
        s = fly(s, 1);
        top = Math.max(top, s.speed);
      }
      return top;
    };
    expect(peak("ASSIST")).toBeLessThanOrEqual(GEAR_SPECS.ASSIST_SPORT.speed);
    expect(peak("ASSIST_SPORT")).toBeGreaterThan(GEAR_SPECS.ASSIST_SPORT.speed);
  });
});

describe("draft", () => {
  it("barely moves Assist and carries ATTI", () => {
    const down = { dir: 1 as const };
    const assist = fly(inEvent("DRAFT", "ASSIST", {}, down), 60);
    const atti = fly(inEvent("DRAFT", "ATTI", {}, down), 60);
    expect(atti.y - WORLD_HEIGHT / 2).toBeGreaterThan(DRAFT_ATTI * 0.5);
    expect(assist.y - WORLD_HEIGHT / 2).toBeLessThan((atti.y - WORLD_HEIGHT / 2) / 4);
  });
});

describe("weak signal and Return-to-Signal", () => {
  it("delivers the controls late", () => {
    const s = inEvent("SIGNAL", "ASSIST_SPORT", {}, { escalates: false });
    const lagged = fly(s, 10, { climb: true });
    const calm = fly(flying("ASSIST_SPORT"), 10, { climb: true });
    expect(calm.y).toBeLessThan(WORLD_HEIGHT / 2 - 5);
    expect(lagged.y).toBeCloseTo(WORLD_HEIGHT / 2, 6);
    expect(fly(s, 40, { climb: true }).y).toBeLessThan(WORLD_HEIGHT / 2 - 5);
  });

  it("drops out halfway when it escalates, counts down, then flies itself back, costing battery", () => {
    let s = inEvent("SIGNAL", "ATTI", {}, { escalates: true, left: EVENT_SPECS.SIGNAL.length / 2 + 1 });
    s = fly(s, 2);
    expect(s.event?.phase).toBe("lost");
    s = fly(s, Math.ceil(LOST_TIME * 60) + 1);
    expect(s.event?.phase).toBe("rts");
    const back = fly(s, 2, { climb: true });
    expect(back.speed).toBeLessThan(0);
    expect(back.y).toBeCloseTo(s.y, 0);
    const home = fly(back, Math.ceil(RTS_TIME * 60) + 2);
    expect(home.event).toBeNull();
    expect(home.status).toBe("flying");
    expect(home.elapsed).toBeGreaterThan(LOST_TIME + RTS_TIME);
  });

  it("is cancelled by a shift inside the countdown, which keeps the gear", () => {
    const lost = inEvent("SIGNAL", "ATTI", {}, { phase: "lost", t: 0 });
    const kept = shiftGear(lost, 1);
    expect(kept.event?.phase).toBe("active");
    expect(kept.event?.escalates).toBe(false);
    expect(kept.gear).toBe("ATTI");
    expect(cancelRts(lost).event?.phase).toBe("active");
    const fine = flying("ATTI");
    expect(cancelRts(fine)).toBe(fine);
  });
});

describe("stabilization disabled", () => {
  it("is manual thrust: it falls unless up is held, and climbs when it is", () => {
    const s = inEvent("STAB", "ASSIST_SPORT", { y: 100 });
    expect(handlingOf(s)).toBe("MANUAL");
    expect(fly(s, 20).y).toBeGreaterThan(105);
    expect(fly(s, 20, { climb: true }).y).toBeLessThan(95);
    expect(handlingOf({ ...s, event: null })).toBe("ASSIST");
  });
});

describe("hanging cables", () => {
  const cabled = (cable: number, y: number): GameState => {
    const built = buildObstacle("PLATEN", 0.5, 1);
    const o: Obstacle = { id: 1, x: 0, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [], cable };
    const placed = { ...o, x: DRONE_X - (gapX(o) - o.x) };
    return { ...flying("ASSIST", { y }), obstacles: [placed] };
  };

  it("snags the cage even inside the collision-tolerant speed", () => {
    const s = stepGame(cabled(80, 70), INPUT);
    expect(s.status).toBe("crashed");
    expect(s.impact?.what).toBe("CABLE");
  });

  it("lets the drone pass beneath", () => {
    expect(stepGame(cabled(80, 80 + DRONE_RADIUS + 2), INPUT).status).toBe("flying");
  });

  it("never hangs so low there is no way under", () => {
    expect(MAX_CABLE + 2 * DRONE_RADIUS + 20).toBeLessThan(WORLD_HEIGHT);
  });

  it("hangs in every gap built while the event lasts", () => {
    const s = fly(inEvent("CABLES", "ASSIST_SPORT"), 60 * 8);
    expect(s.obstacles.some((o) => (o.cable ?? 0) > 0)).toBe(true);
    for (const o of s.obstacles) if (o.cable) expect(o.cable).toBeLessThanOrEqual(MAX_CABLE);
  });
});

describe("radiation", () => {
  it("ends the run once the dose fills, and a fast pass stays under it", () => {
    const slow = fly(inEvent("RADIATION", "ASSIST"), 60 * 9);
    expect(slow.status).toBe("crashed");
    expect(slow.impact?.what).toBe("RADIATION");
    expect(EVENT_SPECS.RADIATION.length / GEAR_SPECS.ATTI.speed).toBeLessThan(7);
  });
});

describe("gas", () => {
  it("fills the LEL meter in the Assist gears and ends the run", () => {
    const slow = fly(inEvent("GAS", "ASSIST_SPORT"), 60 * 5);
    expect(slow.status).toBe("crashed");
    expect(slow.impact?.what).toBe("GAS");
  });

  it("drains it in ATTI, which is fast enough to evacuate", () => {
    expect(GEAR_SPECS.ATTI.speed).toBeGreaterThan(EVAC_SPEED + 30);
    const fast = fly(inEvent("GAS", "ATTI", { lel: 0.5 }), 60);
    expect(fast.status).toBe("flying");
    expect(fast.lel).toBeLessThan(0.5);
  });
});

describe("pick-ups", () => {
  /** A pick-up floating in the gap level with the drone. */
  const withPickup = (kind: PickupKind, gear: Gear = "ASSIST_SPORT", over: Partial<GameState> = {}): GameState => {
    const built = buildObstacle("PLATEN", 0.5, 1);
    const o: Obstacle = { id: 1, x: 0, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [] };
    const placed = { ...o, x: DRONE_X - (gapX(o) - o.x), pickup: { kind, y: 100, taken: false } };
    return { ...flying(gear, { y: 100, ...over }), obstacles: [placed] };
  };

  it("appear in the gaps every so often once events are on, and never off", () => {
    let s = flying("ATTI");
    let found = 0;
    for (let i = 0; i < 60 * 40; i += 1) {
      s = fly(s, 1);
      if (s.status !== "flying") s = { ...s, status: "flying", elapsed: 0 };
      found = Math.max(found, s.obstacles.filter((o) => o.pickup).length);
    }
    expect(found).toBeGreaterThan(0);
    const off = fly({ ...flap(createGame(0, "ATTI")), y: 100 }, 60 * 20);
    expect(off.obstacles.some((o) => o.pickup)).toBe(false);
  });

  it("Repeat Flight takes over: at ATTI speed or better, and it cannot crash", () => {
    let s = stepGame(withPickup("REPEAT"), INPUT);
    expect(s.auto).toBeCloseTo(AUTO_TIME, 1);
    expect(s.obstacles[0].pickup?.taken).toBe(true);
    // Fly it into real steel for most of its time: nothing ends the run.
    for (let i = 0; i < 60 * (AUTO_TIME - 0.5); i += 1) {
      s = stepGame(s, { ...INPUT, kindDraw: (i * 0.618) % 1, placeDraw: (i * 0.414) % 1, descend: true });
      expect(s.status).toBe("flying");
    }
    expect(s.speed).toBeGreaterThan(GEAR_SPECS.ASSIST_SPORT.speed * 2);
    // It scores at ATTI's rate while it flies.
    expect(s.lastGain).toBe(GEAR_SPECS.ATTI.multiplier);
  });

  it("hands back at the gear's own speed when it runs out", () => {
    const s = fly({ ...withPickup("LIGHT"), auto: 0.02, speed: GEAR_SPECS.ATTI.speed }, 3);
    expect(s.auto).toBe(0);
    expect(s.speed).toBeCloseTo(GEAR_SPECS.ASSIST_SPORT.speed, 0);
  });

  it("the dust-proof light lasts its time and changes only the picture", () => {
    const dust: ActiveEvent = { ...startEvent("DUST", 0.3), phase: "active", left: 1e6 };
    const s = stepGame(withPickup("LIGHT", "ASSIST_SPORT", { event: dust }), INPUT);
    expect(s.light).toBeCloseTo(LIGHT_TIME, 1);
    expect(handlingOf(s)).toBe("ATTI");
  });

  it("is missed if the drone flies past too far above or below it", () => {
    const s = stepGame(withPickup("REPEAT", "ASSIST_SPORT", { y: 160 }), INPUT);
    expect(s.auto).toBe(0);
  });
});
