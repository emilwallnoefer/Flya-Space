/**
 * The missions of "Fly where people can't": fixed inspection jobs, each with a
 * course through one or more confined spaces, the flight modes the job allows,
 * a battery, and points to inspect on the way to the exit manhole.
 *
 * The modes come with the job rather than from a free menu, and arrive in the
 * order a pilot meets them: Assist first, the ATTI modes once there is a reason
 * to go faster than the cage allows, ATTI MAN when the sensors give out. Dust
 * takes the Assist modes away for a stretch, the way it blinds the lidar they
 * hold position with.
 *
 * Pure, like the flight rules: a mission's course is drawn from its seed, so
 * every attempt flies the same one and the test suite can check them all.
 */

import {
  BATTERY_SECONDS,
  ZONES,
  batteryLeft,
  kindFor,
  seededRandom,
  type FlightMode,
  type GameState,
  type MissionPlan,
  type CourseEntry,
  type Zone,
} from "@/lib/elios-flight";

export type Mission = {
  id: string;
  title: string;
  /** One or two sentences on the job, in a pilot's register. */
  brief: string;
  /** Spaces in the order flown; consecutive in `ZONES`, each sealed by a bulkhead. */
  spaces: ReadonlyArray<{ zone: Zone; count: number }>;
  /** Course indices (bulkheads included) with an inspection point in the gap after them. */
  pois: readonly number[];
  modes: readonly FlightMode[];
  startMode: FlightMode;
  battery: number;
  denials: ReadonlyArray<{ from: number; to: number; modes: readonly FlightMode[]; reason: string }>;
  seed: number;
};

const DUST: readonly FlightMode[] = ["ASSIST", "ASSIST_SPORT"];

export const MISSIONS: readonly Mission[] = [
  {
    id: "first-look",
    title: "First look",
    brief: "A boiler after an outage. Fly it in Assist and stop at the two marked welds.",
    spaces: [{ zone: "BOILER", count: 5 }],
    pois: [1, 3],
    modes: ["ASSIST"],
    startMode: "ASSIST",
    battery: 40,
    denials: [],
    seed: 11,
  },
  {
    id: "ballast-survey",
    title: "Ballast survey",
    brief: "Three corroded frames in a ballast tank. Assist Sport covers ground; drop back to inspect.",
    spaces: [{ zone: "BALLAST", count: 7 }],
    pois: [1, 3, 5],
    modes: ["ASSIST", "ASSIST_SPORT"],
    startMode: "ASSIST_SPORT",
    battery: 30,
    denials: [],
    seed: 23,
  },
  {
    id: "long-sewer",
    title: "Long sewer",
    brief: "A long trunk sewer on a short battery. Assist Sport will not get you out with charge to spare — ATTI will.",
    spaces: [{ zone: "SEWER", count: 12 }],
    pois: [2, 6, 10],
    modes: ["ASSIST_SPORT", "ATTI"],
    startMode: "ASSIST_SPORT",
    battery: 26,
    denials: [],
    seed: 37,
  },
  {
    id: "dusty-stope",
    title: "Dust in the stope",
    brief: "Blasting dust hangs mid-stope and blinds the lidar: Assist drops out and you fly ATTI through it.",
    spaces: [{ zone: "MINE", count: 10 }],
    pois: [1, 4, 8],
    modes: ["ASSIST", "ASSIST_SPORT", "ATTI"],
    startMode: "ASSIST_SPORT",
    battery: 32,
    denials: [{ from: 3, to: 7, modes: DUST, reason: "Dust — lidar degraded" }],
    seed: 41,
  },
  {
    id: "tank-sprint",
    title: "Tank sprint",
    brief: "A storage tank on a nearly flat battery. ATTI only — brake early, the air will not do it for you.",
    spaces: [{ zone: "TANK", count: 14 }],
    pois: [4, 9],
    modes: ["ATTI", "ATTI_SPORT"],
    startMode: "ATTI",
    battery: 22,
    denials: [],
    seed: 53,
  },
  {
    id: "sensor-failure",
    title: "Sensor failure",
    brief: "The stabilisation is gone. ATTI MAN: nothing holds the aircraft but you.",
    spaces: [{ zone: "BOILER", count: 6 }],
    pois: [3],
    modes: ["ATTI_MAN"],
    startMode: "ATTI_MAN",
    battery: 30,
    denials: [],
    seed: 67,
  },
  {
    id: "full-inspection",
    title: "Full inspection",
    brief: "Every space, one battery, every mode. Dust in the stope again.",
    spaces: [
      { zone: "BOILER", count: 4 },
      { zone: "BALLAST", count: 4 },
      { zone: "MINE", count: 4 },
      { zone: "SEWER", count: 4 },
      { zone: "TANK", count: 4 },
    ],
    pois: [1, 6, 11, 16, 22],
    modes: ["ASSIST", "ASSIST_SPORT", "ATTI", "ATTI_SPORT", "ATTI_MAN"],
    startMode: "ASSIST_SPORT",
    battery: 45,
    denials: [{ from: 10, to: 15, modes: DUST, reason: "Dust — lidar degraded" }],
    seed: 79,
  },
];

/** Share of the battery still left at the exit that earns the third star. */
export const RESERVE = 0.25;

/** Draw a mission's course from its seed: the spaces in order, a bulkhead between each, and the exit. */
export function buildPlan(mission: Mission): MissionPlan {
  const rand = seededRandom(mission.seed);
  const course: CourseEntry[] = [];
  const n = ZONES.length;
  const poiAt = () => 45 + rand() * 110;
  const push = (entry: Omit<CourseEntry, "poi">) => {
    const index = course.length;
    course.push({ ...entry, poi: mission.pois.includes(index) ? poiAt() : null });
  };

  mission.spaces.forEach((space, i) => {
    const zone = ZONES.indexOf(space.zone);
    for (let k = 0; k < space.count; k += 1) {
      const previous = course[course.length - 1]?.kind;
      push({ kind: kindFor(space.zone, rand(), previous), zone, place: rand(), style: rand() });
    }
    // Into the next space, or — after the last — out through the exit.
    const onto = i < mission.spaces.length - 1 ? ZONES.indexOf(mission.spaces[i + 1].zone) : (zone + 1) % n;
    push({ kind: "BULKHEAD", zone: onto, place: rand(), style: rand() });
  });

  return {
    id: mission.id,
    course,
    modes: mission.modes,
    startMode: mission.startMode,
    battery: mission.battery || BATTERY_SECONDS,
    denials: mission.denials,
    pois: mission.pois.length,
  };
}

/** Stars for a run: one for the exit, one for every point inspected, one for the reserve. */
export function missionStars(state: Pick<GameState, "status" | "inspected" | "plan" | "elapsed">): number {
  if (state.status !== "complete" || !state.plan) return 0;
  return 1 + (state.inspected >= state.plan.pois ? 1 : 0) + (batteryLeft(state) >= RESERVE ? 1 : 0);
}

/** Best stars per mission id, as kept in the browser. */
export type Progress = Readonly<Record<string, number>>;

/** Junk in storage is no progress, not an error. */
export function parseProgress(raw: string | null): Progress {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const m of MISSIONS) {
      const stars = (value as Record<string, unknown>)[m.id];
      if (typeof stars === "number" && Number.isInteger(stars) && stars >= 1 && stars <= 3) out[m.id] = stars;
    }
    return out;
  } catch {
    return {};
  }
}

/** Keep the better of two results; a worse run never costs a star. */
export function recordStars(progress: Progress, id: string, stars: number): Progress {
  if (stars <= (progress[id] ?? 0)) return progress;
  return { ...progress, [id]: stars };
}

/** The first mission is always open; each one after opens once the one before is flown out. */
export function isUnlocked(index: number, progress: Progress): boolean {
  if (index <= 0) return true;
  const before = MISSIONS[index - 1];
  return !!before && (progress[before.id] ?? 0) > 0;
}

/** Where to start a visit: the first open mission not yet flown out, or the last open one. */
export function nextMission(progress: Progress): number {
  let last = 0;
  for (let i = 0; i < MISSIONS.length; i += 1) {
    if (!isUnlocked(i, progress)) break;
    last = i;
    if (!progress[MISSIONS[i].id]) return i;
  }
  return last;
}
