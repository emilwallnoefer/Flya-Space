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
  cableAt,
  cableTip,
  createGame,
  doseRate,
  flap,
  gapX,
  inGas,
  modeOf,
  radiationBand,
  speedFor,
  stepGame,
  swingCable,
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

  it("drops out halfway when it escalates and flies itself back that instant, safely", () => {
    let s = inEvent("SIGNAL", "BOILER", {}, { escalates: true, left: EVENT_SPECS.SIGNAL.length / 2 + 1 });
    s = fly(s, 2);
    // No countdown: the moment the link goes, it is already flying back.
    expect(s.event?.phase).toBe("rts");
    expect(s.speed).toBeLessThan(0);
    // Real steel all around while it returns: it retraces a safe path.
    let back = s;
    for (let i = 0; i < Math.ceil(RTS_TIME * 60) + 2; i += 1) back = stepGame(back, { ...INPUT, climb: true });
    expect(back.status).toBe("flying");
    expect(back.event).toBeNull();
  });
});

describe("hanging cables", () => {
  const cabled = (length: number, y: number, angle = 0): GameState => {
    const built = buildObstacle("PLATEN", 0.5, 1);
    const cable = { length, angle, spin: 0 };
    const o: Obstacle = { id: 1, x: 0, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [], cable };
    const placed = { ...o, x: DRONE_X - (gapX(o) - o.x) };
    return { ...flying("BOILER", { y }), obstacles: [placed] };
  };

  it("tangle in the motors: the drone drops and shakes, sheds the rope, and flies on", () => {
    const s = stepGame(cabled(80, 70), INPUT);
    expect(s.status).toBe("flying");
    expect(s.bump?.what).toBe("CABLE");
    expect(s.stun).toBeGreaterThan(0);
    expect(s.velocity).toBeGreaterThan(0);
    // The rope is gone, so it cannot catch the drone a second time.
    expect(s.obstacles[0].cable).toBeUndefined();
    const after = fly(s, 60);
    expect(after.status).toBe("flying");
    expect(after.stun).toBe(0);
  });

  it("let the drone pass beneath", () => {
    expect(stepGame(cabled(80, 80 + DRONE_RADIUS + 2), INPUT).status).toBe("flying");
  });

  it("never hang so low there is no way under", () => {
    expect(MAX_CABLE + 2 * DRONE_RADIUS + 20).toBeLessThan(WORLD_HEIGHT);
  });

  it("hang in every gap built while the event lasts", () => {
    const s = fly(inEvent("CABLES", "BOILER"), 60 * 8);
    expect(s.obstacles.some((o) => !!o.cable)).toBe(true);
    for (const o of s.obstacles) if (o.cable) expect(o.cable.length).toBeLessThanOrEqual(MAX_CABLE);
  });

  it("swing back to hanging straight on their own", () => {
    const o = { x: 200, width: 20 };
    let c = { length: 70, angle: 0.8, spin: 0 };
    for (let i = 0; i < 60 * 8; i += 1) c = swingCable(o, c, 190, 1 / 60);
    expect(Math.abs(c.angle)).toBeLessThan(0.1);
  });

  it("get sucked toward the drone when it flies close", () => {
    // A cable just ahead of the drone, its end a little below and in front.
    const o = { x: DRONE_X + 18 - (20 + 56), width: 20 };
    const still = { length: 70, angle: 0, spin: 0 };
    const [tx] = cableTip(o, still);
    expect(tx).toBeGreaterThan(DRONE_X);
    let c = still;
    for (let i = 0; i < 30; i += 1) c = swingCable(o, c, 85, 1 / 60);
    // Positive angle swings the end back toward the drone.
    expect(c.angle).toBeGreaterThan(0.05);
    // Far from the drone, nothing pulls it.
    let far = still;
    for (let i = 0; i < 30; i += 1) far = swingCable(o, far, 190, 1 / 60);
    expect(far.angle).toBeCloseTo(0, 6);
  });

  it("snag the drone anywhere along their length, not just at the end", () => {
    // Anchored just ahead and swung back over the drone: its middle crosses
    // the drone's line while its end hangs well below.
    const built = buildObstacle("PLATEN", 0.5, 1);
    const anchor = DRONE_X + 20;
    const cable = { length: 80, angle: 0.5, spin: 0 };
    const o: Obstacle = { id: 1, x: anchor - built.width - 56, kind: "PLATEN", zone: 0, seed: 1, passed: true, ...built, solids: [], cable };
    const [tx, ty] = cableTip(o, cable);
    expect(Math.hypot(tx - DRONE_X, ty - 35)).toBeGreaterThan(DRONE_RADIUS * 2);
    expect(cableAt(35, [o])?.what).toBe("CABLE");
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

describe("a long run with everything switched on", () => {
  it("never throws and never goes non-finite", () => {
    for (const zone of ZONES) {
      let s = flying(zone);
      for (let i = 0; i < 60 * 120; i += 1) {
        // A clumsy pilot: climbs and descends in turns, and hits things now and then.
        const phase = Math.floor(i / 40) % 3;
        s = stepGame(s, {
          dt: 1 / 60,
          kindDraw: (i * 0.6180339887) % 1,
          placeDraw: (i * 0.4142135624) % 1,
          styleDraw: (i * 0.7320508075) % 1,
          eventDraw: (i * 0.5772156649) % 1,
          climb: phase === 0 || s.y > WORLD_HEIGHT - 50,
          descend: phase === 2 && s.y < WORLD_HEIGHT - 50,
        });
        expect(Number.isFinite(s.y) && Number.isFinite(s.speed) && Number.isFinite(s.velocity), `${zone} @ ${i}`).toBe(true);
        for (const o of s.obstacles) if (o.cable) expect(Number.isFinite(o.cable.angle)).toBe(true);
        // A crash just starts another run, so the whole two minutes get flown.
        if (s.status === "crashed") s = { ...flying(zone), nextId: s.nextId };
      }
    }
  });
});
