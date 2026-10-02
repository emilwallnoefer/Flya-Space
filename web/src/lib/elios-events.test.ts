import { describe, expect, it } from "vitest";
import {
  AUTO_TIME,
  DRONE_RADIUS,
  DRONE_X,
  GAS_LAYER,
  LIGHT_TIME,
  MAX_CABLE,
  WORLD_HEIGHT,
  ZONES,
  buildObstacle,
  cancelRts,
  createGame,
  doseRate,
  flap,
  gapX,
  inGas,
  modeOf,
  radiationBand,
  speedFor,
  stepGame,
  type GameState,
  type Obstacle,
  type PickupKind,
  type StepInput,
  type Zone,
} from "@/lib/elios-flight";
import {
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

/** A run with events on, flying, mid-screen, in the given space. */
function flying(zone: Zone, over: Partial<GameState> = {}): GameState {
  return { ...flap(createGame(ZONES.indexOf(zone), true)), y: WORLD_HEIGHT / 2, velocity: 0, ...over };
}

/** The same, with an event already biting and far from over. */
function inEvent(kind: EventKind, zone: Zone, over: Partial<GameState> = {}, event: Partial<ActiveEvent> = {}) {
  return flying(zone, { event: { ...startEvent(kind, 0.3), phase: "active", left: 1e6, ...event }, ...over });
}

/** Fly with no steel in the way: obstacles keep spawning, so strip it every frame. */
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
    expect(EVENT_KINDS.length).toBeLessThanOrEqual(7);
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
    const s = fly({ ...flap(createGame(0)), y: 100 }, 60 * 30);
    expect(s.event).toBeNull();
  });

  it("warns first, then bites, then ends after its length, then waits before the next", () => {
    let s = flying("BOILER", { travelled: FIRST_EVENT });
    s = fly(s, 1);
    expect(s.event?.phase).toBe("warning");
    s = fly(s, Math.ceil(WARNING_TIME * 60) + 1);
    expect(s.event?.phase).not.toBe("warning");
    for (let i = 0; i < 60 * 60 && s.event; i += 1) s = fly({ ...s, y: WORLD_HEIGHT / 2 }, 1);
    expect(s.event).toBeNull();
    expect(s.nextEventAt).toBeGreaterThan(s.travelled);
  });
});

describe("dust", () => {
  it("forces ATTI in an Assist space, and hands Assist back once it clears", () => {
    const s = fly(inEvent("DUST", "BOILER"), 1);
    expect(modeOf(s)).toBe("FORCED_ATTI");
    expect(modeOf({ ...s, event: null })).toBe("ASSIST");
  });

  it("changes nothing about the handling in a space that already flies ATTI", () => {
    expect(modeOf(inEvent("DUST", "MINE"))).toBe("ATTI");
  });

  it("makes the drone wander where it held still before", () => {
    const calm = fly(flying("BOILER", { y: 100 }), 120);
    const dusty = fly(inEvent("DUST", "BOILER", { y: 100 }), 120);
    expect(calm.y).toBeCloseTo(100, 6);
    expect(Math.abs(dusty.y - 100)).toBeGreaterThan(3);
  });
});

describe("draft", () => {
  it("barely moves Assist and carries ATTI", () => {
    const down = { dir: 1 as const };
    const assist = fly(inEvent("DRAFT", "BOILER", {}, down), 60);
    const calmAtti = fly(flying("TANK"), 60);
    const atti = fly(inEvent("DRAFT", "TANK", {}, down), 60);
    expect(atti.y - calmAtti.y).toBeGreaterThan(30);
    expect(assist.y - WORLD_HEIGHT / 2).toBeLessThan(15);
  });
});

describe("weak signal and Return-to-Signal", () => {
  it("delivers the controls late", () => {
    const s = inEvent("SIGNAL", "BOILER", {}, { escalates: false });
    const lagged = fly(s, 10, { climb: true });
    const calm = fly(flying("BOILER"), 10, { climb: true });
    expect(calm.y).toBeLessThan(WORLD_HEIGHT / 2 - 5);
    expect(lagged.y).toBeCloseTo(WORLD_HEIGHT / 2, 6);
    expect(fly(s, 40, { climb: true }).y).toBeLessThan(WORLD_HEIGHT / 2 - 5);
  });

  it("drops out halfway when it escalates, counts down, then flies itself back safely", () => {
    let s = inEvent("SIGNAL", "BOILER", {}, { escalates: true, left: EVENT_SPECS.SIGNAL.length / 2 + 1 });
    s = fly(s, 2);
    expect(s.event?.phase).toBe("lost");
    s = fly(s, Math.ceil(LOST_TIME * 60) + 1);
    expect(s.event?.phase).toBe("rts");
    // Real steel all around while it returns: it retraces a safe path.
    let back = s;
    for (let i = 0; i < Math.ceil(RTS_TIME * 60) + 2; i += 1) back = stepGame(back, { ...INPUT, climb: true });
    expect(back.status).toBe("flying");
    expect(back.event).toBeNull();
  });

  it("can be cancelled inside the countdown, and only then", () => {
    const lost = inEvent("SIGNAL", "BOILER", {}, { phase: "lost", t: 0 });
    expect(cancelRts(lost).event?.phase).toBe("active");
    expect(cancelRts(lost).event?.escalates).toBe(false);
    const fine = flying("BOILER");
    expect(cancelRts(fine)).toBe(fine);
  });
});

describe("hanging cables", () => {
  const cabled = (cable: number, y: number): GameState => {
    const built = buildObstacle("PLATEN", 0.5, 1);
    const o: Obstacle = { id: 1, x: 0, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [], cable };
    const placed = { ...o, x: DRONE_X - (gapX(o) - o.x) };
    return { ...flying("BOILER", { y }), obstacles: [placed] };
  };

  it("snag the drone", () => {
    const s = stepGame(cabled(80, 70), INPUT);
    expect(s.status).toBe("crashed");
    expect(s.impact?.what).toBe("CABLE");
  });

  it("let the drone pass beneath", () => {
    expect(stepGame(cabled(80, 80 + DRONE_RADIUS + 2), INPUT).status).toBe("flying");
  });

  it("never hang so low there is no way under", () => {
    expect(MAX_CABLE + 2 * DRONE_RADIUS + 20).toBeLessThan(WORLD_HEIGHT);
  });

  it("hang in every gap built while the event lasts", () => {
    const s = fly(inEvent("CABLES", "BOILER"), 60 * 8);
    expect(s.obstacles.some((o) => (o.cable ?? 0) > 0)).toBe(true);
    for (const o of s.obstacles) if (o.cable) expect(o.cable).toBeLessThanOrEqual(MAX_CABLE);
  });
});

describe("radiation", () => {
  it("doses hardest on the hot band and not at all out of its reach", () => {
    const e: ActiveEvent = { ...startEvent("RADIATION", 0.3), phase: "active" };
    const band = radiationBand(e);
    expect(doseRate(e, band)).toBeGreaterThan(doseRate(e, band + 30));
    expect(doseRate(e, band + 30)).toBeGreaterThan(0);
    const far = band < WORLD_HEIGHT / 2 ? WORLD_HEIGHT - 20 : 20;
    expect(doseRate(e, far)).toBe(0);
  });

  it("ends the run if you sit on the band, and spares you if you keep away", () => {
    const e = { dir: -1 as const };
    const band = radiationBand(e);
    const sitting = fly(inEvent("RADIATION", "BOILER", { y: band }, e), 60 * 9);
    expect(sitting.status).toBe("crashed");
    expect(sitting.impact?.what).toBe("RADIATION");
    const away = fly(inEvent("RADIATION", "BOILER", { y: WORLD_HEIGHT - 30 }, e), 60 * 9);
    expect(away.status).toBe("flying");
  });
});

describe("gas", () => {
  it("lies under the roof or on the floor, and only there", () => {
    const methane: ActiveEvent = { ...startEvent("GAS", 0.3), phase: "active", dir: -1 };
    const h2s: ActiveEvent = { ...methane, dir: 1 };
    expect(inGas(methane, GAS_LAYER / 2)).toBe(true);
    expect(inGas(methane, WORLD_HEIGHT - 30)).toBe(false);
    expect(inGas(h2s, WORLD_HEIGHT - GAS_LAYER / 2)).toBe(true);
    expect(inGas(h2s, 30)).toBe(false);
  });

  it("ends the run if you stay in the layer, and drains once you are out", () => {
    const inside = fly(inEvent("GAS", "BOILER", { y: 30 }, { dir: -1 }), 60 * 3);
    expect(inside.status).toBe("crashed");
    expect(inside.impact?.what).toBe("GAS");
    const out = fly(inEvent("GAS", "BOILER", { y: 140, lel: 0.5 }, { dir: -1 }), 60);
    expect(out.status).toBe("flying");
    expect(out.lel).toBeLessThan(0.5);
  });
});

describe("pick-ups", () => {
  const withPickup = (kind: PickupKind, over: Partial<GameState> = {}): GameState => {
    const built = buildObstacle("PLATEN", 0.5, 1);
    const o: Obstacle = { id: 1, x: 0, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [] };
    const placed = { ...o, x: DRONE_X - (gapX(o) - o.x), pickup: { kind, y: 100, taken: false } };
    return { ...flying("BOILER", { y: 100, ...over }), obstacles: [placed] };
  };

  it("appear in the gaps every so often once events are on, and never off", () => {
    let s = flying("BOILER");
    let found = 0;
    for (let i = 0; i < 60 * 40; i += 1) {
      s = fly({ ...s, y: WORLD_HEIGHT / 2, velocity: 0 }, 1);
      found = Math.max(found, s.obstacles.filter((o) => o.pickup).length);
    }
    expect(found).toBeGreaterThan(0);
    const off = fly({ ...flap(createGame(0)), y: 100 }, 60 * 20);
    expect(off.obstacles.some((o) => o.pickup)).toBe(false);
  });

  it("Repeat Flight takes over and cannot crash, whatever is pressed", () => {
    let s = stepGame(withPickup("REPEAT"), INPUT);
    expect(s.auto).toBeCloseTo(AUTO_TIME, 1);
    expect(s.obstacles[0].pickup?.taken).toBe(true);
    for (let i = 0; i < 60 * (AUTO_TIME - 0.5); i += 1) {
      s = stepGame(s, { ...INPUT, kindDraw: (i * 0.618) % 1, placeDraw: (i * 0.414) % 1, descend: true });
      expect(s.status).toBe("flying");
    }
    expect(s.speed).toBeGreaterThan(speedFor(0) * 0.9);
  });

  it("the dust-proof light lasts its time and changes only the picture", () => {
    const dust: ActiveEvent = { ...startEvent("DUST", 0.3), phase: "active", left: 1e6 };
    const s = stepGame(withPickup("LIGHT", { event: dust }), INPUT);
    expect(s.light).toBeCloseTo(LIGHT_TIME, 1);
    expect(modeOf(s)).toBe("FORCED_ATTI");
  });

  it("is missed if the drone flies past too far above or below it", () => {
    const s = stepGame(withPickup("REPEAT", { y: 160 }), INPUT);
    expect(s.auto).toBe(0);
  });
});
