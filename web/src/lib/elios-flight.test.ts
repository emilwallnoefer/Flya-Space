import { describe, expect, it } from "vitest";
import {
  DRONE_RADIUS,
  DRONE_X,
  EDGE_MARGIN,
  FLAP_VELOCITY,
  GRAVITY,
  KIND_LABELS,
  MAX_FALL_SPEED,
  MAX_SCROLL_SPEED,
  MIN_PASSAGE,
  OBSTACLE_GAP,
  OBSTACLE_KINDS,
  SCROLL_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  ZONE_KINDS,
  ZONE_LENGTH,
  ZONE_NAMES,
  buildObstacle,
  circleHitsSolid,
  clearance,
  createGame,
  crashLine,
  distanceToSegment,
  flap,
  hitsCeiling,
  hitsGround,
  hitsObstacle,
  isNewBest,
  kindFor,
  nearestPointOnSolid,
  parseStoredBest,
  pointInPolygon,
  seedFromDraw,
  seededRandom,
  speedAt,
  stepGame,
  zoneAt,
  type GameState,
  type Obstacle,
  type ObstacleKind,
  type Solid,
  type StepInput,
} from "@/lib/elios-flight";

const INPUT: StepInput = { dt: 1 / 60, kindDraw: 0, placeDraw: 0.5, styleDraw: 0.5 };

function fly(state: GameState, frames: number, input: Partial<StepInput> = {}): GameState {
  let s = state;
  for (let i = 0; i < frames; i += 1) s = stepGame(s, { ...INPUT, ...input });
  return s;
}

/** Place a built obstacle so its left edge sits `into` units behind the drone's centre. */
function at(kind: ObstacleKind, draw: number, seed = 7, into = 10): Obstacle {
  const built = buildObstacle(kind, draw, seed);
  return { id: 1, x: DRONE_X - into, kind, zone: 0, seed, passed: false, ...built };
}

const PLACEMENTS = [0, 0.25, 0.5, 0.75, 1];
const SEEDS = [0, 1, 12345, 0x9e3779b9, 0xffffffff];

/** Heights the drone's centre can occupy without touching `o`. */
function freeHeights(o: Obstacle): number[] {
  const free: number[] = [];
  for (let y = DRONE_RADIUS + 0.5; y <= WORLD_HEIGHT - DRONE_RADIUS - 0.5; y += 1) {
    if (!hitsObstacle(y, o)) free.push(y);
  }
  return free;
}

/** Every unbroken run of free height at least `min` long, as [first, last]. */
function passages(free: number[], min: number): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let start = free[0];
  for (let i = 1; i <= free.length; i += 1) {
    if (i === free.length || free[i] !== free[i - 1] + 1) {
      if (free[i - 1] - start >= min) found.push([start, free[i - 1]]);
      start = free[i];
    }
  }
  return found;
}

describe("the spaces", () => {
  it("gives every space a name and five kinds of its own", () => {
    for (const zone of ZONES) {
      expect(ZONE_NAMES[zone].name.length).toBeGreaterThan(0);
      expect(ZONE_KINDS[zone]).toHaveLength(5);
    }
    const all = ZONES.flatMap((z) => ZONE_KINDS[z]);
    // No kind is shared between spaces, and only the bulkhead belongs to none.
    expect(new Set(all).size).toBe(all.length);
    expect([...all, "BULKHEAD"].sort()).toEqual([...OBSTACLE_KINDS].sort());
  });

  it("names everything the drone can fly into", () => {
    for (const kind of [...OBSTACLE_KINDS, "FLOOR", "CEILING"] as const) {
      expect(KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it("wraps zone indices like the run does", () => {
    expect(zoneAt(0)).toBe("BOILER");
    expect(zoneAt(ZONES.length)).toBe("BOILER");
    expect(zoneAt(-1)).toBe(ZONES[ZONES.length - 1]);
    expect(zoneAt(Number.NaN)).toBe("BOILER");
  });

  it("maps every draw to a kind of that space, and never repeats one back to back", () => {
    for (const zone of ZONES) {
      for (const draw of [0, 0.3, 0.999, 1, 5, -2, Number.NaN]) {
        const kind = kindFor(zone, draw, undefined);
        expect(ZONE_KINDS[zone]).toContain(kind);
        expect(kindFor(zone, draw, kind)).not.toBe(kind);
      }
    }
  });
});

describe("seeded shapes", () => {
  it("draws the same numbers from the same seed", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 20; i += 1) expect(a()).toBe(b());
  });

  it("stays in [0, 1)", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("turns any draw into a 32-bit seed", () => {
    for (const draw of [0, 0.5, 1, -3, 9, Number.NaN]) {
      const seed = seedFromDraw(draw);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("rebuilds an obstacle identically from the same inputs", () => {
    for (const kind of OBSTACLE_KINDS) {
      expect(buildObstacle(kind, 0.4, 99)).toEqual(buildObstacle(kind, 0.4, 99));
    }
  });

  it("cuts ragged kinds differently from different seeds", () => {
    for (const kind of ["CLINKER", "ROCK_JAW", "HANGING_ROCK", "MUCK_PILE", "HANGUP", "DEBRIS", "ROOTS"] as const) {
      expect(buildObstacle(kind, 0.4, 1)).not.toEqual(buildObstacle(kind, 0.4, 2));
    }
  });
});

describe("what you see is what you hit", () => {
  it("keeps every solid inside the obstacle's own footprint", () => {
    // The renderer clips drawing to the solids and caches a sprite per
    // obstacle sized to its width; a point outside would be drawn nowhere.
    for (const kind of OBSTACLE_KINDS) {
      for (const draw of PLACEMENTS) {
        for (const seed of SEEDS) {
          const { width, solids } = buildObstacle(kind, draw, seed);
          for (const s of solids) {
            if (s.shape === "disc") {
              expect(s.cx - s.r).toBeGreaterThanOrEqual(0);
              expect(s.cx + s.r).toBeLessThanOrEqual(width);
              expect(s.cy - s.r).toBeGreaterThanOrEqual(0);
              expect(s.cy + s.r).toBeLessThanOrEqual(WORLD_HEIGHT);
            } else {
              for (const [x, y] of s.points) {
                expect(x, `${kind} x`).toBeGreaterThanOrEqual(-1e-9);
                expect(x, `${kind} x`).toBeLessThanOrEqual(width + 1e-9);
                expect(y, `${kind} y`).toBeGreaterThanOrEqual(-1e-9);
                expect(y, `${kind} y`).toBeLessThanOrEqual(WORLD_HEIGHT + 1e-9);
              }
            }
          }
        }
      }
    }
  });

  it("makes the flange genuinely round, not a box", () => {
    const inlet = buildObstacle("INLET", 0.5);
    expect(inlet.solids).toHaveLength(1);
    expect(inlet.solids[0].shape).toBe("disc");
  });

  it("gives the cross tie its I-section, so the waist is open air", () => {
    const tie = at("CROSS_TIE", 0.5, 7, 0);
    const solid = tie.solids[0];
    if (solid.shape !== "poly") throw new Error("expected a polygon");
    const top = Math.min(...solid.points.map(([, y]) => y));
    // Beside the web at mid-height, inside the bounding box but not the steel.
    expect(circleHitsSolid(tie.x + 3, top + 24, 1, solid, tie.x)).toBe(false);
    expect(circleHitsSolid(tie.x + 20, top + 24, 1, solid, tie.x)).toBe(true);
  });
});

describe("every kind stays flyable", () => {
  // 20 s timeout: ~2.4 s alone, but the full parallel suite on a busy machine pushed it past the 5 s default.
  it("keeps a MIN_PASSAGE-tall way through, unbroken from one side to the other", () => {
    // Sweep the drone across the obstacle a column at a time. A passage only
    // counts if it connects to one that was reachable in the previous column,
    // so two openings at different heights with no way between them fail
    // even though each column on its own has a gap. Mid-air kinds have two
    // ways through and either is fine.
    const min = MIN_PASSAGE - 2 * DRONE_RADIUS - 1;
    for (const kind of OBSTACLE_KINDS) {
      for (const draw of PLACEMENTS) {
        for (const seed of SEEDS) {
          const { width } = buildObstacle(kind, draw, seed);
          let reachable: Array<[number, number]> = [];
          let first = true;
          for (let into = -DRONE_RADIUS; into <= width + DRONE_RADIUS; into += 3) {
            const here = passages(freeHeights(at(kind, draw, seed, into)), min);
            const prev = reachable;
            reachable = first
              ? here
              : here.filter(([a, b]) => prev.some(([c, d]) => Math.min(b, d) - Math.max(a, c) > 0));
            first = false;
            expect(reachable.length, `${kind} @ ${draw} seed ${seed}: no way through at column ${into}`).toBeGreaterThan(0);
          }
        }
      }
    }
  }, 20000);

  it("never buries the opening in the floor or ceiling", () => {
    for (const kind of OBSTACLE_KINDS) {
      for (const draw of [0, 1]) {
        const free = freeHeights(at(kind, draw));
        expect(free.some((y) => y > EDGE_MARGIN && y < WORLD_HEIGHT - EDGE_MARGIN), kind).toBe(true);
      }
    }
  });
});

describe("the double web frame stays a slalom, not a wall", () => {
  /** The y where a plate's edge meets the opening, for each of the two frames. */
  function holes(solids: readonly Solid[]): Array<{ top: number; bottom: number }> {
    const lowestOf = (s: Solid) => (s.shape === "poly" ? Math.max(...s.points.map(([, y]) => y)) : s.cy + s.r);
    const highestOf = (s: Solid) => (s.shape === "poly" ? Math.min(...s.points.map(([, y]) => y)) : s.cy - s.r);
    return [
      { top: lowestOf(solids[0]), bottom: highestOf(solids[1]) },
      { top: lowestOf(solids[2]), bottom: highestOf(solids[3]) },
    ];
  }

  it("never offsets the second hole further than the drone can climb inside the bay", () => {
    // What the flight model allows, at the fastest the run ever gets: one
    // flap's climb, and a free fall over the time the bay lasts.
    for (const draw of PLACEMENTS) {
      for (const seed of SEEDS) {
        const { width, solids } = buildObstacle("DOUBLE_FRAME", draw, seed);
        const [first, second] = holes(solids);
        const bar = 16;
        const bay = width - 2 * bar;
        const seconds = bay / MAX_SCROLL_SPEED;
        const climbOnAFlap = FLAP_VELOCITY ** 2 / (2 * GRAVITY);
        const dropInTheBay = 0.5 * GRAVITY * seconds ** 2;
        const offset = Math.abs(second.top - first.top);
        expect(offset, `DOUBLE_FRAME @ ${draw} seed ${seed}`).toBeLessThanOrEqual(
          Math.min(climbOnAFlap, dropInTheBay) + 1,
        );
        // And it is still a slalom: the holes do not simply line up.
        expect(offset).toBeGreaterThan(8);
      }
    }
  });

  it("gives both frames the same opening, wider than the tightest gap in the game", () => {
    for (const draw of PLACEMENTS) {
      const [first, second] = holes(buildObstacle("DOUBLE_FRAME", draw, 99).solids);
      expect(first.bottom - first.top).toBeGreaterThan(MIN_PASSAGE);
      expect(second.bottom - second.top).toBeCloseTo(first.bottom - first.top, 6);
    }
  });

  it("keeps both holes inside the world, whatever the placement", () => {
    for (const draw of PLACEMENTS) {
      for (const seed of SEEDS) {
        for (const hole of holes(buildObstacle("DOUBLE_FRAME", draw, seed).solids)) {
          expect(hole.top).toBeGreaterThanOrEqual(EDGE_MARGIN - 0.01);
          expect(hole.bottom).toBeLessThanOrEqual(WORLD_HEIGHT - EDGE_MARGIN + 0.01);
        }
      }
    }
  });
});

describe("collision geometry", () => {
  it("measures distance to a segment, including past both ends", () => {
    expect(distanceToSegment(0, 0, -1, 5, 1, 5)).toBeCloseTo(5);
    expect(distanceToSegment(10, 5, -1, 5, 1, 5)).toBeCloseTo(9);
    // Degenerate segment must not divide by zero.
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it("tests points against a polygon", () => {
    const square: Array<readonly [number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
  });

  it("hits a disc by real distance, not a bounding box", () => {
    const disc = { shape: "disc", cx: 50, cy: 50, r: 10 } as const;
    // Dead centre of the corner of its bounding box, but outside the circle.
    expect(circleHitsSolid(50 + 9.9, 50 + 9.9, 1, disc, 0)).toBe(false);
    expect(circleHitsSolid(50 + 10.5, 50, 1, disc, 0)).toBe(true);
  });

  it("finds the nearest point on a solid, and the point itself when inside", () => {
    const disc = { shape: "disc", cx: 0, cy: 0, r: 10 } as const;
    expect(nearestPointOnSolid(20, 0, disc, 0)).toEqual([10, 0]);
    const square = { shape: "poly", points: [[0, 0], [10, 0], [10, 10], [0, 10]] } as const;
    expect(nearestPointOnSolid(5, -4, square, 0)).toEqual([5, 0]);
    expect(nearestPointOnSolid(5, 5, square, 0)).toEqual([5, 5]);
    expect(nearestPointOnSolid(5, -4, square, 100)).toEqual([100, 0]);
  });

  it("lets the drone slip past the sloped face of the hopper", () => {
    // Over the low end of the slope: a box test would call this a hit.
    const hopper = at("HOPPER", 0.5, 7, 0);
    expect(hitsObstacle(WORLD_HEIGHT - DRONE_RADIUS - 6, hopper)).toBe(false);
    expect(hitsObstacle(WORLD_HEIGHT - DRONE_RADIUS - 6, { ...hopper, x: DRONE_X - 60 })).toBe(true);
  });

  it("respects the offset, so a shape only bites where it is drawn", () => {
    const far = { ...at("PLATEN", 0.5), x: 300 };
    expect(hitsObstacle(WORLD_HEIGHT / 2, far)).toBe(false);
  });

  it("measures clearance to the nearest steel, floor and roof included", () => {
    expect(clearance(WORLD_HEIGHT / 2, [])).toBeCloseTo(WORLD_HEIGHT / 2 - DRONE_RADIUS);
    const inlet = { ...at("INLET", 0.5, 7, 0), x: DRONE_X - 22 };
    const disc = inlet.solids[0];
    if (disc.shape !== "disc") throw new Error("expected a disc");
    // Directly above the flange, 5 units of air between cage and steel.
    const y = disc.cy - disc.r - DRONE_RADIUS - 5;
    expect(clearance(y, [inlet])).toBeCloseTo(5);
    expect(clearance(disc.cy, [inlet])).toBeLessThan(0);
  });
});

describe("idle and crashed states are frozen", () => {
  it("does not drop the drone before anyone has played", () => {
    const idle = fly(createGame(), 120);
    expect(idle.status).toBe("idle");
    expect(idle.y).toBe(WORLD_HEIGHT / 2);
    expect(idle.obstacles).toHaveLength(0);
  });

  it("does not keep simulating after a crash", () => {
    const crashed: GameState = { ...createGame(), status: "crashed", y: 50 };
    expect(fly(crashed, 60)).toEqual(crashed);
  });

  it("refuses to revive a crashed run with a flap", () => {
    const crashed: GameState = { ...createGame(), status: "crashed" };
    expect(flap(crashed)).toEqual(crashed);
  });

  it("starts in whichever space it is given, wrapped into range", () => {
    expect(createGame(3).droneZone).toBe(3);
    expect(createGame(ZONES.length + 1).droneZone).toBe(1);
    expect(createGame(Number.NaN).droneZone).toBe(0);
  });
});

describe("flap", () => {
  it("launches the run from idle, so one tap starts and flies", () => {
    const s = flap(createGame());
    expect(s.status).toBe("flying");
    expect(s.velocity).toBe(FLAP_VELOCITY);
  });

  it("always resets velocity, so repeated taps keep lifting", () => {
    const falling: GameState = { ...createGame(), status: "flying", velocity: 200 };
    expect(flap(falling).velocity).toBe(FLAP_VELOCITY);
  });
});

describe("physics", () => {
  it("falls under gravity and rises after a flap", () => {
    const start = flap(createGame());
    const up = fly(start, 6);
    expect(up.y).toBeLessThan(start.y);
    expect(fly(up, 60).y).toBeGreaterThan(up.y);
  });

  it("caps fall speed", () => {
    expect(fly({ ...createGame(), status: "flying" }, 600).velocity).toBeLessThanOrEqual(MAX_FALL_SPEED);
  });

  it("clamps a huge timestep instead of teleporting through an obstacle", () => {
    const s = stepGame({ ...createGame(), status: "flying" }, { ...INPUT, dt: 30 });
    expect(Number.isFinite(s.y)).toBe(true);
    expect(s.y).toBeLessThanOrEqual(WORLD_HEIGHT);
  });

  it("ignores a negative timestep rather than running backwards", () => {
    expect(stepGame({ ...createGame(), status: "flying" }, { ...INPUT, dt: -5 }).y).toBe(WORLD_HEIGHT / 2);
  });
});

describe("crash detection", () => {
  it("crashes into the floor and the ceiling", () => {
    expect(hitsGround(WORLD_HEIGHT - DRONE_RADIUS)).toBe(true);
    expect(hitsCeiling(DRONE_RADIUS)).toBe(true);
    expect(hitsGround(WORLD_HEIGHT / 2)).toBe(false);
    expect(hitsCeiling(WORLD_HEIGHT / 2)).toBe(false);
  });

  it("parks the drone inside the world, not through a surface, and says it hit the floor", () => {
    const s = fly({ ...createGame(), status: "flying", y: WORLD_HEIGHT - 20 }, 90);
    expect(s.status).toBe("crashed");
    expect(s.y).toBeLessThanOrEqual(WORLD_HEIGHT - DRONE_RADIUS);
    expect(s.y).toBeGreaterThanOrEqual(DRONE_RADIUS);
    expect(s.impact?.what).toBe("FLOOR");
  });

  it("names the obstacle it hit and marks the point of contact on it", () => {
    const pendant = at("PENDANT", 1, 7, 10);
    const state: GameState = { ...createGame(), status: "flying", y: 40, velocity: 0, obstacles: [pendant] };
    const s = stepGame(state, INPUT);
    expect(s.status).toBe("crashed");
    expect(s.impact?.what).toBe("PENDANT");
    // The contact point lies on the pendant, within a cage radius of the drone.
    expect(Math.hypot((s.impact?.x ?? 0) - DRONE_X, (s.impact?.y ?? 0) - s.y)).toBeLessThanOrEqual(DRONE_RADIUS + 1);
  });

  it("leaves no impact on a clean frame", () => {
    expect(stepGame(flap(createGame()), INPUT).impact).toBeNull();
  });
});

describe("scoring", () => {
  it("scores an obstacle once, when it is fully behind the drone", () => {
    const state: GameState = {
      ...createGame(),
      status: "flying",
      y: 100,
      obstacles: [at("HANGUP", 0, 7, DRONE_X)],
    };
    const scored = fly(state, 30);
    expect(scored.score).toBeGreaterThan(0);
    expect(fly(scored, 30).score).toBe(scored.score);
  });

  it("does not score an obstacle still ahead", () => {
    const state: GameState = {
      ...createGame(),
      status: "flying",
      y: 100,
      obstacles: [{ ...at("PLATEN", 0.5), x: 240 }],
    };
    expect(stepGame(state, INPUT).score).toBe(0);
  });
});

describe("a run through the spaces", () => {
  /** Fly a long, invulnerable run and record every obstacle as it is built. */
  function tour(startZone: number, frames: number) {
    let s = flap(createGame(startZone));
    const built: Obstacle[] = [];
    const zonesFlown: number[] = [s.droneZone];
    for (let i = 0; i < frames; i += 1) {
      s = stepGame(s, {
        ...INPUT,
        kindDraw: (i * 0.6180339887) % 1,
        placeDraw: (i * 0.4142135624) % 1,
        styleDraw: (i * 0.7320508075) % 1,
      });
      for (const o of s.obstacles) if (!built.some((b) => b.id === o.id)) built.push(o);
      if (s.droneZone !== zonesFlown[zonesFlown.length - 1]) zonesFlown.push(s.droneZone);
      // Keep flying through crashes: this is about the sequence, not the pilot.
      if (s.status === "crashed") s = { ...s, status: "flying", y: WORLD_HEIGHT / 2, velocity: 0, impact: null };
    }
    return { built, zonesFlown, final: s };
  }

  it("builds ZONE_LENGTH obstacles per space, then a bulkhead into the next", () => {
    const { built } = tour(2, 6000);
    expect(built.length).toBeGreaterThan(3 * (ZONE_LENGTH + 1));
    let zone = 2;
    built.forEach((o, i) => {
      const inCycle = i % (ZONE_LENGTH + 1);
      if (inCycle === ZONE_LENGTH) {
        zone = (zone + 1) % ZONES.length;
        expect(o.kind, `obstacle ${i}`).toBe("BULKHEAD");
      } else {
        expect(ZONE_KINDS[ZONES[zone]], `obstacle ${i}`).toContain(o.kind);
      }
      expect(o.zone).toBe(zone);
    });
  });

  it("moves the drone into the next space as it clears the bulkhead, and only then", () => {
    const { zonesFlown } = tour(4, 6000);
    expect(zonesFlown.slice(0, 4)).toEqual([4, 0, 1, 2]);
  });

  it("gives every obstacle its own id and never repeats a kind back to back", () => {
    const { built } = tour(0, 6000);
    expect(new Set(built.map((o) => o.id)).size).toBe(built.length);
    for (let i = 1; i < built.length; i += 1) expect(built[i].kind).not.toBe(built[i - 1].kind);
  });

  it("retires obstacles off-screen instead of accumulating them", () => {
    const { final } = tour(1, 3000);
    expect(final.obstacles.length).toBeLessThan(8);
    expect(final.obstacles.every((o) => o.x + o.width > -8 && o.x <= WORLD_WIDTH)).toBe(true);
  });
});

describe("the run speeds up as it goes", () => {
  it("starts at the pace the game always had", () => {
    expect(speedAt(0)).toBe(SCROLL_SPEED);
  });

  it("accelerates with time in the air, then holds at the cap", () => {
    expect(speedAt(10)).toBeGreaterThan(speedAt(0));
    expect(speedAt(40)).toBeGreaterThan(speedAt(10));
    expect(speedAt(600)).toBe(MAX_SCROLL_SPEED);
    expect(speedAt(1e9)).toBe(MAX_SCROLL_SPEED);
  });

  it("treats junk elapsed as the start of a run", () => {
    expect(speedAt(-5)).toBe(SCROLL_SPEED);
    expect(speedAt(Number.NaN)).toBe(SCROLL_SPEED);
  });

  it("moves the world further per frame later in the run", () => {
    const travelled = (elapsed: number) => {
      const before: GameState = {
        ...createGame(),
        status: "flying",
        y: 100,
        elapsed,
        obstacles: [{ ...at("PLATEN", 0.5), x: 200 }],
      };
      return 200 - stepGame(before, INPUT).obstacles[0].x;
    };
    expect(travelled(0)).toBeCloseTo(SCROLL_SPEED / 60, 1);
    expect(travelled(90)).toBeCloseTo(MAX_SCROLL_SPEED / 60, 1);
    expect(travelled(90)).toBeGreaterThan(travelled(0) * 1.7);
  });

  it("keeps the spacing between obstacles, so only the time to read one shrinks", () => {
    // The gap is measured in world units, not seconds: speeding the world up
    // must not also crowd the obstacles together.
    let s = flap(createGame());
    const gaps: number[] = [];
    let seen = s.obstacles.length;
    for (let i = 0; i < 9000; i += 1) {
      s = stepGame(s, { ...INPUT, kindDraw: (i * 0.618) % 1, placeDraw: (i * 0.414) % 1 });
      if (s.obstacles.length > seen && s.obstacles.length > 1) {
        const fresh = s.obstacles[s.obstacles.length - 1];
        const previous = s.obstacles[s.obstacles.length - 2];
        gaps.push(fresh.x - (previous.x + previous.width));
      }
      seen = s.obstacles.length;
      if (s.status === "crashed") s = { ...s, status: "flying", y: WORLD_HEIGHT / 2, velocity: 0, impact: null };
    }
    expect(gaps.length).toBeGreaterThan(20);
    // Never tighter than the gap, and never looser than the one frame of
    // travel it takes to notice the previous obstacle has moved far enough.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(OBSTACLE_GAP - 0.01);
      expect(gap).toBeLessThanOrEqual(OBSTACLE_GAP + MAX_SCROLL_SPEED * INPUT.dt + 0.01);
    }
  });

  it("is what makes a long run hard: the same flight is faster at the end", () => {
    // Same obstacle, same drone, later in the run: less time to cross it.
    const crossing = (elapsed: number) => {
      // Follow this one obstacle out: the spawner keeps the screen full, so
      // counting obstacles would never end.
      const tracked = 4242;
      let s: GameState = {
        ...createGame(),
        status: "flying",
        y: 100,
        elapsed,
        obstacles: [{ ...at("PLATEN", 0.5), id: tracked, x: 300 }],
      };
      let frames = 0;
      while (s.obstacles.some((o) => o.id === tracked) && frames < 3000) {
        s = stepGame({ ...s, status: "flying", y: 100, velocity: 0, impact: null }, INPUT);
        frames += 1;
      }
      return frames;
    };
    expect(crossing(90)).toBeLessThan(crossing(0) * 0.7);
  });
});

describe("best score", () => {
  it("counts a first real score but never a zero", () => {
    expect(isNewBest(1, null)).toBe(true);
    expect(isNewBest(0, null)).toBe(false);
  });

  it("is strictly higher-is-better", () => {
    expect(isNewBest(5, 3)).toBe(true);
    expect(isNewBest(3, 5)).toBe(false);
    expect(isNewBest(3, 3)).toBe(false);
  });

  it("treats junk in storage as no score", () => {
    for (const raw of [null, "", "abc", "NaN", "-2", "0", "2.5", "{}"]) {
      expect(parseStoredBest(raw)).toBeNull();
    }
    expect(parseStoredBest("7")).toBe(7);
  });
});

describe("crashLine", () => {
  it("says something for every score and does not scold a zero", () => {
    for (const score of [0, 1, 2, 3, 7, 8, 14, 15, 99]) {
      expect(crashLine(score).length).toBeGreaterThan(0);
    }
    expect(crashLine(0)).not.toMatch(/bad|terrible|useless|fail/i);
  });
});
