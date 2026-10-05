import { parseDateFromMonthYearDay, parseFullDate } from "@/lib/google-sheets";

/**
 * Field stats: what the pilots did, counted from the "Mission planning" tab of
 * the planning spreadsheet. Pure — the sheet fetch lives in
 * `field-stats-sheet.ts`, and `today` is passed in so nothing here reads the
 * clock.
 *
 * The tab is a calendar: one row per day, and one column group per pilot whose
 * cells are free text ("Tronder Energie POC", "travel time", "Camilla"). So the
 * numbers are heuristics over that text. The rules are exported and covered by
 * `field-stats.test.ts` — when a real cell is miscounted, fix it there.
 */

/** Stats start here: the sheet goes back to 2018, the team cares about 2026 on. */
export const FIELD_STATS_FROM = "2026-01-01";

/** Shown for an event whose "Reporting to" cell is empty. */
export const UNASSIGNED_REGION = "Unassigned";

export type PilotColumns = {
  name: string;
  /** Column index of the pilot's activity cell (the column headed with their name). */
  activity: number;
  status: number;
  /** "Reporting to" / "Deadline + sales name"; null when the pilot has no such column. */
  reporting: number | null;
};

export type DayKind = "poc" | "training" | "other";

export type ClassifiedDay = {
  /** Null when the day does not count at all (blank, off, blocked, unconfirmed). */
  kind: DayKind | null;
  travel: boolean;
};

export type PilotStats = { pilot: string; poc: number; training: number; travelDays: number };

export type RegionStats = {
  region: string;
  /** POCs + trainings that reported to this region's salesperson. */
  events: number;
  poc: number;
  training: number;
};

export type FieldStatsBucket = { pilots: PilotStats[]; regions: RegionStats[] };

/** One POC or training, as counted: the rows behind a bar in the POC/training/region charts. */
export type FieldEvent = {
  pilot: string;
  kind: "poc" | "training";
  /** First and last counted day (YYYY-MM-DD); the event counts in `start`'s month. */
  start: string;
  end: string;
  /** Counted days, not the calendar span (a weekend in between is not a day). */
  days: number;
  /** The activity cell of the first day, as written in the sheet. */
  title: string;
  salesName: string;
  region: string;
};

/** One counted travel day: the rows behind a bar in the travel-days chart. */
export type FieldTravelDay = { pilot: string; date: string; activity: string; status: string };

export type FieldStats = {
  from: string;
  to: string;
  /** "YYYY-MM", oldest first; every month in range, including empty ones. */
  months: string[];
  all: FieldStatsBucket;
  byMonth: Record<string, FieldStatsBucket>;
  /** Every counted POC/training, oldest first. Filter by `start` month for a month view. */
  events: FieldEvent[];
  /** Every counted travel day, oldest first. */
  travel: FieldTravelDay[];
  /** Every salesperson name seen, so admins can map each one to a region. */
  salesNames: string[];
};

const NON_PILOT_HEADER = /^(status|reporting|deadline|logged|date|w|d)\b/i;

function cell(row: readonly unknown[] | undefined, index: number | null): string {
  if (!row || index === null || index < 0) return "";
  return String(row[index] ?? "").trim();
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Finds the pilots in the header row. A pilot is a named column followed by a
 * "Status…" column; the column after that is their reporting column when its
 * header says so. Layouts differ per pilot (Name|Status|Reporting to,
 * Name|Status|Deadline + sales name, Name|Status), and this covers all three,
 * so a pilot added to the sheet shows up without a code change.
 */
export function findPilotColumns(header: readonly unknown[]): PilotColumns[] {
  const pilots: PilotColumns[] = [];
  for (let i = 0; i < header.length - 1; i++) {
    const name = cell(header, i);
    if (!name || NON_PILOT_HEADER.test(name)) continue;
    if (!/^status/i.test(cell(header, i + 1))) continue;
    const reportingHeader = cell(header, i + 2);
    pilots.push({
      name: titleCase(name),
      activity: i,
      status: i + 1,
      reporting: /reporting|sales name/i.test(reportingHeader) ? i + 2 : null,
    });
  }
  return pilots;
}

const UNCONFIRMED = /\btbc\b|\bpre[\s-]?booked\b|to be confirmed|\bcancell?ed\b|\bpostponed\b/i;
const UNAVAILABLE =
  /^(off|day off|not available|n\/a|blocked|blocker|holiday|holidays|bank holiday|public holiday|vacation|vacances|sick|compensation|weekend)\b/i;
const POC = /\bpocs?\b|\bdemos?\b/i;
const TRAINING = /\btrainings?\b/i;
const TRAVEL = /\btravel/i;
const AWAY_STATUS = /out of (the )?office|abroad/i;
const AT_HOME_STATUS = /\bin the office\b|\boffice\b|lausanne|\bremote\b|\bhome\b/i;

/**
 * Classifies one pilot-day from its activity and status cells.
 *
 * - Not counted: empty, off/blocked/unavailable, and anything unconfirmed
 *   ("TBC …", "pre booked") — a hold is not a trip.
 * - `poc` wins over `training` when a cell names both ("Demo + training").
 * - A travel day is a day spent travelling ("travel to X", "travel time") or
 *   away ("booked out of the office"), and a POC/training day that is not marked
 *   as in the office — those happen on the customer's site.
 */
export function classifyDay(activityRaw: string, statusRaw: string): ClassifiedDay {
  const activity = activityRaw.trim();
  const status = statusRaw.trim();
  if (!activity && !status) return { kind: null, travel: false };
  if (UNCONFIRMED.test(activity) || UNCONFIRMED.test(status)) return { kind: null, travel: false };
  if (UNAVAILABLE.test(activity) || (!activity && UNAVAILABLE.test(status))) {
    return { kind: null, travel: false };
  }

  const kind: DayKind = POC.test(activity) ? "poc" : TRAINING.test(activity) ? "training" : "other";
  const travel =
    TRAVEL.test(activity) ||
    TRAVEL.test(status) ||
    AWAY_STATUS.test(status) ||
    (kind !== "other" && !AT_HOME_STATUS.test(status));
  return { kind, travel };
}

/**
 * The salesperson in a reporting cell. "Reporting to" holds a name; the older
 * "Deadline + sales name" column mixes in a date ("15.10 Igor"). Takes the
 * first name when several are listed.
 */
export function salesNameFrom(raw: string): string {
  const cleaned = raw
    .replace(/deadline/gi, " ")
    .replace(/\d[\d./:-]*/g, " ")
    .split(/[,/&+;]|\band\b/i)[0]
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–-]+|[\s:–-]+$/g, "");
  return cleaned ? titleCase(cleaned) : "";
}

/** Region for a salesperson: the admin mapping (case-insensitive), else the name itself. */
export function regionFor(salesName: string, salesRegions: Record<string, string>): string {
  if (!salesName) return UNASSIGNED_REGION;
  const key = salesName.toLowerCase();
  for (const [name, region] of Object.entries(salesRegions)) {
    if (name.trim().toLowerCase() === key && region.trim()) return region.trim();
  }
  return salesName;
}

/** The part of an activity that identifies one event across its days. */
function eventKey(activity: string): string {
  return activity.toLowerCase().replace(/\s+/g, " ").trim();
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Days of the same event may be split by a weekend or a travel day. */
const MAX_EVENT_GAP_DAYS = 3;

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > endKey) break;
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

type Tally = {
  pilots: Map<string, PilotStats>;
  regions: Map<string, RegionStats>;
};

function newTally(pilotNames: string[]): Tally {
  return {
    pilots: new Map(pilotNames.map((pilot) => [pilot, { pilot, poc: 0, training: 0, travelDays: 0 }])),
    regions: new Map(),
  };
}

function finishTally(tally: Tally): FieldStatsBucket {
  return {
    pilots: [...tally.pilots.values()],
    regions: [...tally.regions.values()].sort((a, b) => b.events - a.events || a.region.localeCompare(b.region)),
  };
}

/**
 * Computes the stats from the raw tab: `header` is row 1, `rows` every row
 * after it (in sheet order — the month/year cell is carried down because the
 * sheet merges it). Counts days from `from` through `today`, both inclusive.
 */
export function computeFieldStats({
  header,
  rows,
  today,
  salesRegions = {},
  from = FIELD_STATS_FROM,
}: {
  header: readonly unknown[];
  rows: readonly (readonly unknown[])[];
  today: string;
  salesRegions?: Record<string, string>;
  from?: string;
}): FieldStats {
  const pilots = findPilotColumns(header);
  const pilotNames = pilots.map((p) => p.name);
  const months = today >= from ? monthsBetween(from, today) : [];
  const all = newTally(pilotNames);
  const byMonth = new Map(months.map((m) => [m, newTally(pilotNames)]));
  const salesNames = new Set<string>();

  const events: FieldEvent[] = [];
  const travelDays: FieldTravelDay[] = [];

  // Open event per pilot: the last POC/training day seen, to merge multi-day events.
  const open = new Map<string, { kind: DayKind; key: string; lastDate: string; event: FieldEvent }>();

  let activeMonthYear = "";
  for (const row of rows) {
    const monthYear = cell(row, 0);
    const fullDate = parseFullDate(monthYear);
    if (!fullDate && monthYear) activeMonthYear = monthYear;
    const date = fullDate ?? parseDateFromMonthYearDay(activeMonthYear, cell(row, 2));
    if (!date || date < from || date > today) continue;
    const month = byMonth.get(date.slice(0, 7));
    if (!month) continue;

    for (const pilot of pilots) {
      const activity = cell(row, pilot.activity);
      const status = cell(row, pilot.status);
      const { kind, travel } = classifyDay(activity, status);
      if (!kind) continue;

      if (travel) {
        all.pilots.get(pilot.name)!.travelDays += 1;
        month.pilots.get(pilot.name)!.travelDays += 1;
        travelDays.push({ pilot: pilot.name, date, activity, status });
      }
      if (kind === "other") continue;

      const key = eventKey(activity);
      const previous = open.get(pilot.name);
      const continues =
        previous !== undefined &&
        previous.kind === kind &&
        previous.key === key &&
        daysBetween(previous.lastDate, date) <= MAX_EVENT_GAP_DAYS;
      if (previous && continues) {
        previous.lastDate = date;
        previous.event.end = date;
        previous.event.days += 1;
        continue;
      }

      // A new event, counted in the month it starts.
      const salesName = salesNameFrom(cell(row, pilot.reporting));
      if (salesName) salesNames.add(salesName);
      const region = regionFor(salesName, salesRegions);
      const event: FieldEvent = { pilot: pilot.name, kind, start: date, end: date, days: 1, title: activity, salesName, region };
      events.push(event);
      open.set(pilot.name, { kind, key, lastDate: date, event });
      for (const tally of [all, month]) {
        tally.pilots.get(pilot.name)![kind] += 1;
        const entry = tally.regions.get(region) ?? { region, events: 0, poc: 0, training: 0 };
        entry.events += 1;
        entry[kind] += 1;
        tally.regions.set(region, entry);
      }
    }
  }

  return {
    from,
    to: today,
    months,
    all: finishTally(all),
    byMonth: Object.fromEntries([...byMonth].map(([m, tally]) => [m, finishTally(tally)])),
    events,
    travel: travelDays,
    salesNames: [...salesNames].sort((a, b) => a.localeCompare(b)),
  };
}
