import { describe, expect, it } from "vitest";
import {
  DRONE_RADIUS,
  DRONE_X,
  MAX_CABLE,
  MODE_SPECS,
  SAFE_SPEED,
  WORLD_HEIGHT,
  ZONES,
  allowedModes,
  buildObstacle,
  cancelRts,
  createGame,
  flap,
  gapX,
  setMode,
  stepGame,
  type FlightMode,
  type GameState,
  type Obstacle,
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
function flying(mode: FlightMode, over: Partial<GameState> = {}): GameState {
  return { ...flap(createGame(0, mode, undefined, true)), status: "flying", y: WORLD_HEIGHT / 2, velocity: 0, ...over };
}

/** The same, with an event already biting and far from over. */
function inEvent(kind: EventKind, mode: FlightMode, over: Partial<GameState> = {}, event: Partial<ActiveEvent> = {}) {
  return flying(mode, { event: { ...startEvent(kind, 0.3), phase: "active", left: 1e6, ...event }, ...over });
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
  it("forces Assist out to ATTI, refuses it back, and returns to it once the dust clears", () => {
    const s = fly(inEvent("DUST", "ASSIST_SPORT"), 1);
    expect(s.mode).toBe("ATTI");
    expect(s.forcedFrom).toBe("ASSIST_SPORT");
    expect(setMode(s, "ASSIST")).toBe(s);
    const cleared = fly({ ...s, event: null }, 1);
    expect(cleared.mode).toBe("ASSIST_SPORT");
    expect(cleared.forcedFrom).toBeNull();
  });

  it("keeps the speed setting under the cage when it forces ATTI", () => {
    const s = fly(inEvent("DUST", "ASSIST_SPORT"), 1);
    expect(s.target).toBeLessThanOrEqual(SAFE_SPEED + 1e-6);
  });
});

describe("lidar heat", () => {
  it("overheats the lidar if you dawdle in the heat, and Assist drops out", () => {
    const slow = fly(inEvent("HEAT", "ASSIST"), 60 * 7);
    expect(slow.lidarOff).toBe(true);
    expect(allowedModes(slow)).not.toContain("ASSIST");
  });

  it("cools down again once out of it", () => {
    const hot = { ...flying("ATTI"), heat: 1, lidarOff: true };
    const cooled = fly(hot, 60 * 5);
    expect(cooled.lidarOff).toBe(false);
  });

  it("is short enough to cross at ATTI speed before it cooks the lidar", () => {
    // Time in the heat at full ATTI speed, against the time it takes to overheat.
    expect(EVENT_SPECS.HEAT.length / MODE_SPECS.ATTI.maxSpeed).toBeLessThan(6);
    expect(EVENT_SPECS.HEAT.length / MODE_SPECS.ASSIST_SPORT.maxSpeed).toBeGreaterThan(6);
  });
});

describe("featureless walls", () => {
  it("jerks Assist about, and leaves ATTI alone", () => {
    const assist = fly(inEvent("FEATURELESS", "ASSIST_SPORT"), 60);
    const atti = fly(inEvent("FEATURELESS", "ATTI", { speed: 90, target: 90 }), 60);
    expect(Math.abs(assist.y - WORLD_HEIGHT / 2)).toBeGreaterThan(5);
    expect(atti.y).toBeCloseTo(WORLD_HEIGHT / 2, 6);
    // It is the pilot's call: nothing is forced.
    expect(assist.mode).toBe("ASSIST_SPORT");
  });
});

describe("draft", () => {
  it("barely moves Assist, carries ATTI, and throws ATTI MAN about", () => {
    const down = { dir: 1 as const };
    const assist = fly(inEvent("DRAFT", "ASSIST", {}, down), 60);
    const atti = fly(inEvent("DRAFT", "ATTI", { speed: 90, target: 90 }, down), 60);
    expect(atti.y - WORLD_HEIGHT / 2).toBeCloseTo(DRAFT_ATTI, 0);
    expect(assist.y - WORLD_HEIGHT / 2).toBeLessThan((atti.y - WORLD_HEIGHT / 2) / 4);
    const manual = fly(inEvent("DRAFT", "ATTI_MAN", { y: 60, speed: 60, target: 60 }, { dir: -1 }), 20);
    const calm = fly(flying("ATTI_MAN", { y: 60, speed: 60, target: 60 }), 20);
    expect(manual.y).toBeLessThan(calm.y);
  });
});

describe("weak signal and Return-to-Signal", () => {
  it("delivers the controls late", () => {
    const s = inEvent("SIGNAL", "ATTI", { speed: 90, target: 90 }, { escalates: false });
    const quick = fly(s, 10, { climb: true });
    const calm = fly(flying("ATTI", { speed: 90, target: 90 }), 10, { climb: true });
    expect(calm.y).toBeLessThan(WORLD_HEIGHT / 2 - 5);
    expect(quick.y).toBeCloseTo(WORLD_HEIGHT / 2, 6);
    // …but it does arrive.
    expect(fly(s, 40, { climb: true }).y).toBeLessThan(WORLD_HEIGHT / 2 - 5);
  });

  it("drops out halfway when it escalates, counts down, then flies itself back", () => {
    let s = inEvent("SIGNAL", "ATTI", { speed: 90, target: 90 }, { escalates: true, left: EVENT_SPECS.SIGNAL.length / 2 + 1 });
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
  });

  it("can be cancelled inside the countdown, and only then", () => {
    const lost = inEvent("SIGNAL", "ATTI", {}, { phase: "lost", t: 0 });
    expect(cancelRts(lost).event?.phase).toBe("active");
    expect(cancelRts(lost).event?.escalates).toBe(false);
    const fine = flying("ATTI");
    expect(cancelRts(fine)).toBe(fine);
  });
});

describe("stabilization disabled", () => {
  it("leaves only ATTI MAN, and hands Assist back afterwards", () => {
    const s = fly(inEvent("STAB", "ASSIST_SPORT"), 1);
    expect(s.mode).toBe("ATTI_MAN");
    expect(allowedModes(s)).toEqual(["ATTI_MAN"]);
    expect(fly({ ...s, event: null }, 1).mode).toBe("ASSIST_SPORT");
  });
});

describe("hanging cables", () => {
  const cabled = (cable: number, y: number): GameState => {
    const built = buildObstacle("PLATEN", 0.5, 1);
    const o: Obstacle = { id: 1, x: 0, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [], cable };
    const placed = { ...o, x: DRONE_X - (gapX(o) - o.x) };
    return { ...flying("ASSIST", { y, speed: 20, target: 20 }), obstacles: [placed] };
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
    let s = inEvent("CABLES", "ASSIST_SPORT");
    s = fly(s, 60 * 8);
    expect(s.obstacles.some((o) => (o.cable ?? 0) > 0)).toBe(true);
    for (const o of s.obstacles) if (o.cable) expect(o.cable).toBeLessThanOrEqual(MAX_CABLE);
  });
});

describe("radiation", () => {
  it("ends the run once the dose fills, and a fast pass stays under it", () => {
    const slow = fly(inEvent("RADIATION", "ASSIST"), 60 * 9);
    expect(slow.status).toBe("crashed");
    expect(slow.impact?.what).toBe("RADIATION");
    expect(EVENT_SPECS.RADIATION.length / MODE_SPECS.ATTI.maxSpeed).toBeLessThan(7);
  });
});

describe("gas", () => {
  it("fills the LEL meter below evacuation speed and ends the run", () => {
    const slow = fly(inEvent("GAS", "ASSIST_SPORT"), 60 * 5);
    expect(slow.status).toBe("crashed");
    expect(slow.impact?.what).toBe("GAS");
  });

  it("drains it at evacuation speed", () => {
    const fast = fly(inEvent("GAS", "ATTI", { speed: EVAC_SPEED + 20, target: MODE_SPECS.ATTI.maxSpeed, lel: 0.5 }), 60);
    expect(fast.status).toBe("flying");
    expect(fast.lel).toBeLessThan(0.5);
  });
});
