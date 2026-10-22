import { parseDateFromMonthYearDay, parseFullDate } from "@/lib/google-sheets";
import type { UserRole } from "@/lib/user-role";

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

/**
 * Pilots who joined after `FIELD_STATS_FROM`: their workdays start on their
 * first day, so their shares measure the time they were here.
 */
export const PILOT_FIRST_DAYS: Record<string, string> = { Tiago: "2026-05-04" };

/**
 * Columns laid out like a pilot's that are not part of the field team: left out
 * of every chart, the region totals included (owner decision, 2026-10-22).
 */
export const NOT_FIELD_PILOTS = ["Charles", "Matteo", "Marketing"];

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

/**
 * One pilot's days measured against their workdays: Monday to Friday, from the
 * later of `from` and their first day, minus the days their cell is red in the
 * sheet (off, bank holiday, compensation). A day only counts here when it is
 * such a workday, so every share stays between 0 and 100%.
 */
export type PilotWorkdays = {
  pilot: string;
  workDays: number;
  pocDays: number;
  trainingDays: number;
  travelDays: number;
};

export type FieldStatsBucket = { pilots: PilotStats[]; regions: RegionStats[]; workdays: PilotWorkdays[] };

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

/**
 * Who sees the entries behind the counts (customer names, pilots' activity and
 * status text, salesperson names): pilots and admins, who also get the planning
 * sheet itself. Sales and HR get the counts only. Owner decision, audit run-5.
 */
export function canSeeFieldStatsDetail(role: UserRole | null, isAdmin: boolean): boolean {
  return isAdmin || role === "eu_pilot" || role === "us_pilot";
}

/** The counts without a single sheet cell's text. */
export function withoutDetail(stats: FieldStats): FieldStats {
  return { ...stats, events: [], travel: [], salesNames: [] };
}

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

/**
 * Words that name the kind of work rather than the customer: course and visit
 * names change from day to day of one booking ("Intro Training Tesla", then
 * "AIIM Training Tesla") while the customer stays.
 */
const NON_CUSTOMER_WORDS = new Set([
  "training", "trainings", "poc", "pocs", "demo", "demos", "intro", "introduction", "aiim", "ut",
  "advanced", "basic", "basics", "refresher", "recurrent", "theory", "practical", "practice", "flight",
  "flights", "inspection", "inspections", "mission", "day", "days", "part", "session", "onsite",
  "on-site", "online", "remote", "follow", "up", "follow-up", "continued", "continuation", "visit",
  "and", "with", "for", "the", "at", "in", "of", "to", "a", "an", "by", "on", "plus",
]);

/**
 * The customer words of an activity. Anything in brackets is a note
 * ("(learn from Emil)"), not the customer, so it is dropped.
 */
export function customerWords(activity: string): Set<string> {
  const words = activity
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !NON_CUSTOMER_WORDS.has(word));
  return new Set(words);
}

/**
 * Whether two consecutive days of the same kind belong to one booking: the
 * same text, or a customer word in common. Two days that name no customer at
 * all only merge when their text is identical.
 */
export function sameBooking(a: string, b: string): boolean {
  if (eventKey(a) === eventKey(b)) return true;
  const first = customerWords(a);
  for (const word of customerWords(b)) if (first.has(word)) return true;
  return false;
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

function finishTally(tally: Tally): Omit<FieldStatsBucket, "workdays"> {
  return {
    pilots: [...tally.pilots.values()],
    regions: [...tally.regions.values()].sort((a, b) => b.events - a.events || a.region.localeCompare(b.region)),
  };
}

/**
 * The date of every row (YYYY-MM-DD, or null for a row without one). The
 * month/year cell is carried down because the sheet merges it.
 */
export function rowDates(rows: readonly (readonly unknown[])[]): (string | null)[] {
  let activeMonthYear = "";
  return rows.map((row) => {
    const monthYear = cell(row, 0);
    const fullDate = parseFullDate(monthYear);
    if (!fullDate && monthYear) activeMonthYear = monthYear;
    return fullDate ?? parseDateFromMonthYearDay(activeMonthYear, cell(row, 2));
  });
}

/** Key of a cell in `offCells`: the row's index in `rows`, and the column index. */
export function offCellKey(rowIndex: number, column: number): string {
  return `${rowIndex}:${column}`;
}

/** Whether a sheet background is the "OFF / Bank holiday / Compensation" red (channels 0–1, missing = 0). */
export function isOffRed(color: { red?: number | null; green?: number | null; blue?: number | null } | null | undefined): boolean {
  if (!color) return false;
  return (color.red ?? 0) >= 0.8 && (color.green ?? 0) <= 0.35 && (color.blue ?? 0) <= 0.35;
}

/** Used only when the cell colours could not be read: the words the red cells usually carry. */
const OFF_TEXT = /^(off|day off|holiday|holidays|bank holiday|public holiday|vacation|vacances|sick|compensation)\b/i;

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Computes the stats from the raw tab: `header` is row 1, `rows` every row
 * after it (in sheet order — the month/year cell is carried down because the
 * sheet merges it). Counts days from `from` (inclusive) up to `today`
 * (exclusive): only what has already happened — today and later are plans.
 */
export function computeFieldStats({
  header,
  rows,
  today,
  salesRegions = {},
  from = FIELD_STATS_FROM,
  offCells,
  firstDays = PILOT_FIRST_DAYS,
}: {
  header: readonly unknown[];
  rows: readonly (readonly unknown[])[];
  today: string;
  salesRegions?: Record<string, string>;
  from?: string;
  /** Pilot activity cells painted red (`offCellKey`); without them, the cell text decides. */
  offCells?: ReadonlySet<string>;
  /** Pilot name → first day (YYYY-MM-DD), for pilots who joined after `from`. */
  firstDays?: Record<string, string>;
}): FieldStats {
  const excluded = new Set(NOT_FIELD_PILOTS.map((name) => name.toLowerCase()));
  const pilots = findPilotColumns(header).filter((p) => !excluded.has(p.name.toLowerCase()));
  const pilotNames = pilots.map((p) => p.name);
  const months = today >= from ? monthsBetween(from, today) : [];
  const all = newTally(pilotNames);
  const byMonth = new Map(months.map((m) => [m, newTally(pilotNames)]));
  const salesNames = new Set<string>();

  const events: FieldEvent[] = [];
  const travelDays: FieldTravelDay[] = [];

  // Open event per pilot: the last POC/training day seen, to merge multi-day events.
  const open = new Map<string, { kind: DayKind; activity: string; lastDate: string; event: FieldEvent }>();

  const firstDayOf = (pilot: string) => {
    const first = firstDays[pilot];
    return first && first > from ? first : from;
  };
  // Days that count against workdays, per month, and the dates each pilot was off (red).
  const shares = new Map(
    months.map((m) => [m, new Map(pilotNames.map((p) => [p, { pocDays: 0, trainingDays: 0, travelDays: 0 }]))]),
  );
  const offDates = new Map(pilotNames.map((p) => [p, new Set<string>()]));

  const dates = rowDates(rows);
  rows.forEach((row, rowIndex) => {
    const date = dates[rowIndex];
    if (!date || date < from || date >= today) return;
    const month = byMonth.get(date.slice(0, 7));
    if (!month) return;

    for (const pilot of pilots) {
      const activity = cell(row, pilot.activity);
      const status = cell(row, pilot.status);
      const { kind, travel } = classifyDay(activity, status);

      const off = offCells ? offCells.has(offCellKey(rowIndex, pilot.activity)) : OFF_TEXT.test(activity);
      const workday = isWeekday(date) && date >= firstDayOf(pilot.name);
      if (workday && off) offDates.get(pilot.name)!.add(date);
      if (workday && !off && kind) {
        const counts = shares.get(date.slice(0, 7))!.get(pilot.name)!;
        if (kind === "poc") counts.pocDays += 1;
        if (kind === "training") counts.trainingDays += 1;
        if (travel) counts.travelDays += 1;
      }
      if (!kind) continue;

      if (travel) {
        all.pilots.get(pilot.name)!.travelDays += 1;
        month.pilots.get(pilot.name)!.travelDays += 1;
        travelDays.push({ pilot: pilot.name, date, activity, status });
      }
      if (kind === "other") continue;

      const previous = open.get(pilot.name);
      const continues =
        previous !== undefined &&
        previous.kind === kind &&
        sameBooking(previous.activity, activity) &&
        daysBetween(previous.lastDate, date) <= MAX_EVENT_GAP_DAYS;
      if (previous && continues) {
        previous.lastDate = date;
        previous.activity = activity;
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
      open.set(pilot.name, { kind, activity, lastDate: date, event });
      for (const tally of [all, month]) {
        tally.pilots.get(pilot.name)![kind] += 1;
        const entry = tally.regions.get(region) ?? { region, events: 0, poc: 0, training: 0 };
        entry.events += 1;
        entry[kind] += 1;
        tally.regions.set(region, entry);
      }
    }
  });

  // Workdays come from the calendar, not the rows: a weekday the sheet skips is still a workday.
  const workDays = new Map(months.map((m) => [m, new Map(pilotNames.map((p) => [p, 0]))]));
  for (let date = from; date < today; date = nextDay(date)) {
    const perPilot = workDays.get(date.slice(0, 7));
    if (!perPilot || !isWeekday(date)) continue;
    for (const pilot of pilotNames) {
      if (date >= firstDayOf(pilot) && !offDates.get(pilot)!.has(date)) perPilot.set(pilot, perPilot.get(pilot)! + 1);
    }
  }
  const workdaysOver = (selected: string[]): PilotWorkdays[] =>
    pilotNames.map((pilot) => {
      const entry: PilotWorkdays = { pilot, workDays: 0, pocDays: 0, trainingDays: 0, travelDays: 0 };
      for (const m of selected) {
        const counts = shares.get(m)!.get(pilot)!;
        entry.workDays += workDays.get(m)!.get(pilot)!;
        entry.pocDays += counts.pocDays;
        entry.trainingDays += counts.trainingDays;
        entry.travelDays += counts.travelDays;
      }
      return entry;
    });

  return {
    from,
    to: today,
    months,
    all: { ...finishTally(all), workdays: workdaysOver(months) },
    byMonth: Object.fromEntries(
      [...byMonth].map(([m, tally]) => [m, { ...finishTally(tally), workdays: workdaysOver([m]) }]),
    ),
    events,
    travel: travelDays,
    salesNames: [...salesNames].sort((a, b) => a.localeCompare(b)),
  };
}
