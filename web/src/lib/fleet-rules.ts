/**
 * Fleet module — pure business rules.
 *
 * Everything in here is deliberately free of Supabase, Next, and `Date.now()`
 * (callers pass `today`), so the reservation calendar, the reliability score and
 * the reminder cron all agree on one implementation and can be unit-tested.
 *
 * The three ideas the module is built around:
 *
 *  1. **Days.** A booking is an inclusive run of calendar days — pick it up
 *     Tuesday, back Thursday. Missions rarely line up with Monday-to-Sunday,
 *     and rounding a two-day job up to a whole week made the old sheet look
 *     fully booked while half the fleet sat on a shelf.
 *  2. **Every asset has one current location**, and every movement writes an
 *     event. "Where is it" is answered by the asset row; "how did it get there"
 *     by its event history.
 *  3. **Reliability score.** Bringing material back on time earns trust; not
 *     bringing it back costs it. The score sets how far ahead you may book and
 *     where you land in the queue for a contested day, so the person who never
 *     returns anything is last in line, automatically.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/* -------------------------------------------------------------------------- */
/* Date math                                                                   */
/* -------------------------------------------------------------------------- */

export function toDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses `YYYY-MM-DD` as a UTC midnight date. Throws on malformed input. */
export function parseDateKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid date key: ${key}`);
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date key: ${key}`);
  return date;
}

export function addDays(dateKey: string, days: number): string {
  const d = parseDateKey(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / DAY_MS);
}

/** Inclusive length of a span, in days. A single-day booking is 1. */
export function spanLength(startDate: string, endDate: string): number {
  return daysBetween(startDate, endDate) + 1;
}

/** The `count` day keys starting at `startDate`. */
export function dayRange(startDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(startDate, i));
}

/** `YYYY-MM-DD` for the Monday of the week containing `dateKey`. */
export function mondayOf(dateKey: string): string {
  const d = parseDateKey(dateKey);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return toDateKey(d);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(dateKey: string): number {
  return (parseDateKey(dateKey).getUTCDay() + 6) % 7;
}

export function isWeekend(dateKey: string): boolean {
  return weekdayIndex(dateKey) >= 5;
}

/** ISO week number + ISO year, for the calendar's week rule ("KW 36"). */
export function isoWeekNumber(dateKey: string): { week: number; year: number } {
  const d = parseDateKey(mondayOf(dateKey));
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS);
  return { week, year };
}

/**
 * Fixed name tables. Deliberately not `Intl.DateTimeFormat`: ICU renders
 * September as "Sept" in some locales/runtime versions and "Sep" in others, so
 * the calendar header would shift width between the server and the browser.
 */
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const SHORT_WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/**
 * Full month names, for the calendar's month band. Fixed for the same reason
 * `SHORT_MONTHS` is, and so the band costs no ICU call per column.
 */
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "4 Sep" — a single day, for column headers and inline dates. */
export function formatDay(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
}

/** "Th" — the weekday initial above a calendar column. */
export function formatWeekday(dateKey: string): string {
  return SHORT_WEEKDAYS[weekdayIndex(dateKey)];
}

/** "Thu 4 Sep" — a day with its weekday, for prose and emails. */
export function formatDayLong(dateKey: string): string {
  return `${SHORT_WEEKDAYS[weekdayIndex(dateKey)]} ${formatDay(dateKey)}`;
}

/**
 * "4 – 8 Sep", collapsing the month when the span sits inside one, and
 * collapsing entirely for a single day.
 */
export function formatSpan(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDay(startDate);
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = sameMonth
    ? `${start.getUTCDate()}`
    : `${start.getUTCDate()} ${SHORT_MONTHS[start.getUTCMonth()]}`;
  return `${startLabel} – ${end.getUTCDate()} ${SHORT_MONTHS[end.getUTCMonth()]}`;
}

/**
 * Everything the calendar needs to know about one day column.
 *
 * Note what is NOT here: anything about a particular asset. These facts depend
 * only on the day, the viewer's horizon and what today is, which is what makes
 * them shareable across every row of the grid.
 */
export type DayMeta = {
  key: string;
  /** Day number for the column header ("4"). */
  dayOfMonth: number;
  /** Weekday initial for the column header ("Th"). */
  weekdayLabel: string;
  /** "September 2026", for the month band above the columns. */
  monthLabel: string;
  weekend: boolean;
  isToday: boolean;
  /** A Monday that is not the first column — where the week rule is drawn. */
  weekBoundary: boolean;
  /** ISO week number, shown as the column's "KW 36" tooltip. */
  isoWeek: number;
  /** Earlier than today: nothing can be booked here. */
  inPast: boolean;
  /** Further ahead than this viewer's reliability score lets them book. */
  beyondHorizon: boolean;
};

/**
 * Describes a whole window of day columns in one pass.
 *
 * The grid renders one cell per asset per day — roughly 400 of them — and every
 * one of those facts used to be recomputed per cell, each call re-parsing the
 * date string through a regex and a fresh `Date`. At ~1,500 parses per render,
 * on a component that re-renders for every keystroke in the search box and
 * every click in the calendar, that is what made the board feel sticky.
 *
 * Here a single `Date` is stepped forward across the window, so the work is
 * O(days) once per window instead of O(assets x days) on every render.
 */
export function describeDays(args: {
  windowStart: string;
  windowDays: number;
  today: string;
  horizonDays: number;
}): DayMeta[] {
  const { windowStart, windowDays, today, horizonDays } = args;
  const cursor = parseDateKey(windowStart);
  const todayMs = parseDateKey(today).getTime();
  const days: DayMeta[] = [];

  for (let i = 0; i < windowDays; i += 1) {
    const key = toDateKey(cursor);
    const weekday = (cursor.getUTCDay() + 6) % 7;
    // Whole days from today; negative in the past. Same value `daysBetween`
    // would return, without re-parsing either side.
    const offset = Math.round((cursor.getTime() - todayMs) / DAY_MS);

    days.push({
      key,
      dayOfMonth: cursor.getUTCDate(),
      weekdayLabel: SHORT_WEEKDAYS[weekday],
      monthLabel: `${LONG_MONTHS[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
      weekend: weekday >= 5,
      isToday: offset === 0,
      weekBoundary: i > 0 && weekday === 0,
      isoWeek: isoWeekNumber(key).week,
      inPast: offset < 0,
      beyondHorizon: offset > horizonDays,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/** Collapses a described window into the month bands above the columns. */
export function monthBands(days: DayMeta[]): Array<{ label: string; span: number }> {
  const bands: Array<{ label: string; span: number }> = [];
  for (const day of days) {
    const last = bands[bands.length - 1];
    if (last && last.label === day.monthLabel) last.span += 1;
    else bands.push({ label: day.monthLabel, span: 1 });
  }
  return bands;
}

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

export type ReservationStatus =
  | "reserved"
  | "waitlisted"
  | "picked_up"
  | "returned"
  | "cancelled";

/** Where a reservation came from. Imported rows are provisional — see `computeReliability`. */
export type ReservationSource = "app" | "sheet_import";

/**
 * Why a booking is closed. `returned` and `cancelled` mirror the status; the
 * rest say *how* it got there, which the score needs: a `no_show` (booked,
 * never collected, span passed) is scored mildly, while an `expired` waitlist
 * entry or a `moved`/`shortened` booking judges nobody.
 */
export type ClosedReason = "returned" | "cancelled" | "no_show" | "expired" | "moved" | "shortened";

export type ReservationSpan = {
  id: string;
  asset_id: string;
  /** Null while the booking is filed under a name nobody has claimed yet. */
  user_id: string | null;
  /** First booked day, `YYYY-MM-DD`. */
  start_date: string;
  /** Last booked day, inclusive — a one-day booking has start === end. */
  end_date: string;
  status: ReservationStatus;
  /** `YYYY-MM-DD` the material actually came back, set on check-in. */
  returned_on?: string | null;
  /** Free-text holder, used when `user_id` is null. */
  holder_label?: string | null;
  /** Defaults to "app" when absent, so existing callers are unaffected. */
  source?: ReservationSource;
  /** Set when the booking closed; null/absent while live or for rows older than the column. */
  closed_reason?: ClosedReason | null;
};

/** Half-open comparison on inclusive day spans. */
export function spansOverlap(a: ReservationSpan, b: ReservationSpan): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

/**
 * Whether an asset belongs in the booking calendar.
 *
 * Two conditions, both about "could someone actually take this":
 *   - it is in the shared POOL, rather than assigned to a person, region or
 *     customer (an assignment is fixed; booking it is not a thing you can do);
 *   - it is not retired or in repair.
 *
 * Lives here rather than in the query layer so the server filter and the client
 * filter cannot drift apart.
 */
export function isBookable(asset: { pooled: boolean; status: string }): boolean {
  return asset.pooled && asset.status !== "retired" && asset.status !== "in_repair";
}

/** A span is "holding" the asset when it is booked or physically out. */
export function isBlocking(status: ReservationStatus): boolean {
  return status === "reserved" || status === "picked_up";
}

/**
 * How to close a live booking whose asset is being moved between the shared
 * pool and a fixed assignment — the booking cannot survive the move either way,
 * but *how* it ends decides whether the score judges the holder for it.
 *
 * - `picked_up` -> `returned`: the material was physically out and is now back.
 *   That is a genuine return, and it is scored like one (late if it is late).
 * - `reserved` -> `cancelled`: nobody ever collected it. Recording a return for
 *   material that never left the shelf would invent history, and an overdue
 *   never-collected booking would then be scored as a late return — a penalty
 *   for something the holder did not do.
 *
 * Anything else is already closed and is left alone.
 */
export function closureStatusFor(status: ReservationStatus): "returned" | "cancelled" | null {
  if (status === "picked_up") return "returned";
  if (status === "reserved") return "cancelled";
  return null;
}

/**
 * Which layer of the calendar a booking belongs to.
 *
 * The grid draws two: live bookings, which hold the asset, and finished ones,
 * which answer "who had this in March". `showPast` hides the second layer.
 *
 * The order of these checks is the safety property. A booking that is still
 * holding the asset is ALWAYS "live", whatever `showPast` says — hiding one
 * would draw a booked unit as free and let somebody book on top of it. Only a
 * completed booking can be hidden.
 */
export function calendarLayerFor(
  status: ReservationStatus,
  showPast: boolean,
): "live" | "history" | null {
  if (isBlocking(status)) return "live";
  if (status === "returned") return showPast ? "history" : null;
  return null; // cancelled and waitlisted hold nothing and are never drawn
}

/**
 * The last day the material is due back: the final booked day itself.
 * Everything overdue-related keys off this one definition.
 */
export function dueDateOf(span: Pick<ReservationSpan, "end_date">): string {
  return span.end_date;
}

/**
 * The last day a booking actually occupied the asset, for DISPLAY.
 *
 * A booking normally runs to its end date. When the material came back early,
 * it stops on the day it was returned: the unit was back on the shelf for the
 * rest of the booked span, and drawing it as still held made the board look
 * fuller than the fleet was — the exact failure the spreadsheet had. Those days
 * were already bookable (a returned booking blocks nothing); only the picture
 * was wrong.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never runs past `end_date`. A late return is shown by the overdue
 *    marking, not by stretching the booking over days it was never booked for.
 *  - It is not `dueDateOf`. The due date is what lateness and reminders are
 *    measured against and must stay the day that was promised, whatever
 *    actually happened.
 */
export function occupiedUntil(span: ReservationSpan): string {
  if (span.status !== "returned" || !span.returned_on) return span.end_date;
  // Never invert the span: a returned_on before the start would otherwise draw
  // a booking that ends before it begins.
  if (span.returned_on < span.start_date) return span.start_date;
  return span.returned_on < span.end_date ? span.returned_on : span.end_date;
}

/**
 * The last day a booking BLOCKS the asset, as of `today`.
 *
 * Normally the end date. But material that was picked up and is past due is
 * still physically out, so the unit is not on the shelf for anyone else: the
 * booking keeps blocking, day by day, until it is checked in. Without this the
 * grid drew the days after the due date as free, and the next person could
 * book — and even "pick up" — a unit that had not come back.
 *
 * Only `picked_up` stretches. A `reserved` booking past its end date was never
 * collected; it is a no-show, closed by the daily cron, and blocks nothing
 * beyond its own span.
 */
export function blockedUntil(span: ReservationSpan, today: string): string {
  if (span.status === "picked_up" && span.end_date < today) return today;
  return span.end_date;
}

/**
 * Days overdue as of `today`: material that was picked up and is still out past
 * its due date. 0 within the booked span, 0 once it is back (a late return is
 * history, not a live debt), and 0 for a booking that was never collected — a
 * no-show is not "out", and is closed by the cron as one.
 */
export function daysOverdue(span: ReservationSpan, today: string): number {
  if (span.status !== "picked_up") return 0;
  return Math.max(0, daysBetween(dueDateOf(span), today));
}

/**
 * Whether a live-looking row should be closed by the daily sweep.
 *
 * - `no_show`: reserved, never picked up, and the whole span is in the past.
 *   Left alone it would be scored as "still out" forever and mailed "check it
 *   in" for material that never left the shelf.
 * - `expired`: a waitlist entry whose span has passed can never be promoted.
 */
export function expiryFor(span: ReservationSpan, today: string): "no_show" | "expired" | null {
  if (span.end_date >= today) return null;
  if (span.status === "reserved") return "no_show";
  if (span.status === "waitlisted") return "expired";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Interchangeable units                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The slug admins give a kind of unit ("elios-3"). Lower-cased, trimmed,
 * runs of anything that is not a letter or digit become one dash, so "Elios 3"
 * and " elios-3 " are the same kind. Empty → null (no kind).
 */
export function normalizeKindKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

export type SiblingAsset = {
  id: string;
  name: string;
  kind_key: string | null;
  pooled: boolean;
  status: string;
  active?: boolean;
  current_location?: string | null;
};

export type FreeSibling = { asset_id: string; name: string; location: string | null };

/**
 * Other units of the same kind that are free for the whole span: bookable
 * (pooled, not retired or in repair), still active, and with no live booking
 * on any of the days — an overdue unit still out counts as taken through today
 * (`blockedUntil`). A unit with no kind has no siblings; nothing is guessed
 * from the model text.
 */
export function freeSiblings(args: {
  asset: Pick<SiblingAsset, "id" | "kind_key">;
  startDate: string;
  endDate: string;
  today: string;
  assets: SiblingAsset[];
  spans: ReservationSpan[];
}): FreeSibling[] {
  const { asset, startDate, endDate, today, assets, spans } = args;
  if (!asset.kind_key) return [];
  const candidate: ReservationSpan = {
    id: "candidate",
    asset_id: "",
    user_id: null,
    start_date: startDate,
    end_date: endDate,
    status: "reserved",
  };
  return assets
    .filter(
      (a) =>
        a.id !== asset.id &&
        a.kind_key === asset.kind_key &&
        a.active !== false &&
        isBookable(a) &&
        !spans.some(
          (s) =>
            s.asset_id === a.id &&
            isBlocking(s.status) &&
            spansOverlap({ ...s, end_date: blockedUntil(s, today) }, candidate),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((a) => ({ asset_id: a.id, name: a.name, location: a.current_location ?? null }));
}

/** How late a completed return was; 0 when it landed on or before the due date. */
export function lateDays(span: ReservationSpan): number {
  if (span.status !== "returned" || !span.returned_on) return 0;
  return Math.max(0, daysBetween(dueDateOf(span), span.returned_on));
}

export type ConflictCheck =
  | { ok: true }
  | { ok: false; reason: "overlap"; conflicting: ReservationSpan[] }
  | { ok: false; reason: "inverted" }
  | { ok: false; reason: "past" }
  | { ok: false; reason: "too_long"; maxDays: number }
  | { ok: false; reason: "beyond_horizon"; horizonDays: number };

/** Twelve weeks. Longer than this is a transfer, not a booking. */
export const MAX_RESERVATION_DAYS = 84;

/**
 * Validates a requested span against the asset's existing bookings and the
 * requester's booking horizon. `existing` should already be scoped to the asset.
 */
export function checkReservation(args: {
  startDate: string;
  endDate: string;
  today: string;
  horizonDays: number;
  existing: ReservationSpan[];
  /** Ignore this reservation when re-checking an edit of an existing booking. */
  ignoreId?: string;
}): ConflictCheck {
  const { startDate, endDate, today, horizonDays, existing, ignoreId } = args;
  if (endDate < startDate) return { ok: false, reason: "inverted" };

  // Today itself is bookable — you can walk to the shelf and take something now.
  if (startDate < today) return { ok: false, reason: "past" };

  if (spanLength(startDate, endDate) > MAX_RESERVATION_DAYS) {
    return { ok: false, reason: "too_long", maxDays: MAX_RESERVATION_DAYS };
  }

  if (daysBetween(today, startDate) > horizonDays) {
    return { ok: false, reason: "beyond_horizon", horizonDays };
  }

  const candidate: ReservationSpan = {
    id: "candidate",
    asset_id: "",
    user_id: null,
    start_date: startDate,
    end_date: endDate,
    status: "reserved",
  };
  // An overdue unit still out blocks up to today, not just to its due date.
  const conflicting = existing.filter(
    (span) =>
      span.id !== ignoreId &&
      isBlocking(span.status) &&
      spansOverlap({ ...span, end_date: blockedUntil(span, today) }, candidate),
  );
  if (conflicting.length > 0) return { ok: false, reason: "overlap", conflicting };

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Reliability score                                                           */
/* -------------------------------------------------------------------------- */

export type ReliabilityTier = "trusted" | "standard" | "watch" | "restricted";

export type ReliabilityScore = {
  score: number;
  tier: ReliabilityTier;
  /** Days ahead this person may book. */
  horizonDays: number;
  /** How many completed reservations fed the score. */
  completed: number;
  onTime: number;
  late: number;
  /** Currently past due and still out. */
  overdue: number;
  /** Bookings that were never collected and lapsed. */
  noShows: number;
  /** Human-readable one-liner for the UI badge. */
  summary: string;
};

/**
 * No history yet: start provisional rather than perfect, so a brand-new account
 * cannot outrank a colleague with a long clean record, and so the score has
 * somewhere to go up.
 */
export const PROVISIONAL_SCORE = 75;

const TIER_THRESHOLDS: ReadonlyArray<{ min: number; tier: ReliabilityTier; horizonDays: number }> = [
  { min: 85, tier: "trusted", horizonDays: 84 },
  { min: 60, tier: "standard", horizonDays: 56 },
  { min: 35, tier: "watch", horizonDays: 28 },
  { min: 0, tier: "restricted", horizonDays: 7 },
];

export function tierFor(score: number): { tier: ReliabilityTier; horizonDays: number } {
  const match = TIER_THRESHOLDS.find((t) => score >= t.min) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
  return { tier: match.tier, horizonDays: match.horizonDays };
}

export const TIER_LABEL: Record<ReliabilityTier, string> = {
  trusted: "Trusted",
  standard: "Standard",
  watch: "Watch",
  restricted: "Restricted",
};

/** Penalty for a return that landed `d` days after the due date. */
function latePenalty(d: number): number {
  if (d <= 0) return 0;
  // A day or two late is a nudge; a month late is most of the score.
  return Math.min(30, 4 + 2 * d);
}

/** Penalty for material that is past due and *still out* — grows while it stays out. */
function overduePenalty(d: number): number {
  if (d <= 0) return 0;
  return Math.min(45, 6 + 3 * d);
}

/**
 * Penalty for a booking that was never collected. Mild and flat: nobody was
 * deprived of material that stayed on the shelf, but the days were held from
 * everyone else, so it is not free either. Capped so a run of forgotten
 * bookings cannot sink someone the way a month-late return does.
 */
export const NO_SHOW_PENALTY = 3;
export const NO_SHOW_PENALTY_CAP = 15;

/**
 * Computes one person's reliability from their reservation history.
 *
 * Scoring is intentionally simple and explainable — people have to trust it,
 * because it decides who gets the drone:
 *
 *   start at 100
 *   + 2  per on-time return   (rewards a long clean record, capped at 100)
 *   − latePenalty(days)       per late return
 *   − overduePenalty(days)    per item currently out past its due date
 *   − NO_SHOW_PENALTY         per booking never collected (capped)
 *
 * Someone with no completed reservations and nothing overdue is `PROVISIONAL_SCORE`.
 *
 * Rows with `source: "sheet_import"` are skipped entirely. They were written by
 * a migration from the old spreadsheet, with a guessed due date and a holder
 * who never agreed to it — penalising someone for one would make the score
 * arbitrary on its very first day, which is how you teach people to distrust it.
 * Imported rows still hold the asset on the calendar; they just judge nobody.
 */
export function computeReliability(spans: ReservationSpan[], today: string): ReliabilityScore {
  let onTime = 0;
  let late = 0;
  let overdue = 0;
  let noShows = 0;
  let penalty = 0;
  let bonus = 0;

  for (const span of spans) {
    if (span.source === "sheet_import") continue;
    if (span.status === "cancelled") {
      // A cancellation judges nobody — unless the booking lapsed uncollected.
      if (span.closed_reason === "no_show") noShows += 1;
      continue;
    }

    if (span.status === "returned") {
      const d = lateDays(span);
      if (d > 0) {
        late += 1;
        penalty += latePenalty(d);
      } else {
        onTime += 1;
        bonus += 2;
      }
      continue;
    }

    const d = daysOverdue(span, today);
    if (d > 0) {
      overdue += 1;
      penalty += overduePenalty(d);
    }
  }

  penalty += Math.min(NO_SHOW_PENALTY_CAP, noShows * NO_SHOW_PENALTY);

  const completed = onTime + late;
  // A no-show does not lift anyone off the provisional start — otherwise a
  // forgotten first booking would score better than no booking at all.
  const base = completed === 0 && overdue === 0 ? PROVISIONAL_SCORE : 100;
  const score = clamp(Math.round(base + bonus - penalty), 0, 100);
  const { tier, horizonDays } = tierFor(score);

  return {
    score,
    tier,
    horizonDays,
    completed,
    onTime,
    late,
    overdue,
    noShows,
    summary: summarize({ score, completed, onTime, late, overdue, noShows, tier }),
  };
}

function summarize(s: {
  score: number;
  completed: number;
  onTime: number;
  late: number;
  overdue: number;
  noShows: number;
  tier: ReliabilityTier;
}): string {
  if (s.overdue > 0) {
    return `${s.overdue} item${s.overdue === 1 ? "" : "s"} still out past the due date`;
  }
  const noShowNote = s.noShows > 0 ? `, ${s.noShows} booking${s.noShows === 1 ? "" : "s"} never collected` : "";
  if (s.completed === 0) return s.noShows > 0 ? `No returns yet${noShowNote}` : "No return history yet";
  if (s.late === 0) return `${s.onTime} return${s.onTime === 1 ? "" : "s"}, all on time${noShowNote}`;
  return `${s.onTime}/${s.completed} returns on time${noShowNote}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* Queue ordering                                                              */
/* -------------------------------------------------------------------------- */

export type QueueEntry = {
  reservation_id: string;
  user_id: string;
  score: number;
  /** ISO timestamp the request came in. */
  requested_at: string;
};

/**
 * Orders a contested span's waitlist. Higher reliability first; ties broken by
 * who asked first, so the score never makes the queue non-deterministic.
 *
 * This is the visible consequence of the score: if you do not bring material
 * back, you drop below everyone who does.
 */
export function orderQueue(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.requested_at !== b.requested_at) return a.requested_at < b.requested_at ? -1 : 1;
    return a.reservation_id < b.reservation_id ? -1 : 1;
  });
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

export type ReminderKind = "due_soon" | "due_today" | "overdue";

/**
 * Which reminder (if any) a live reservation earns today.
 *
 * - `due_soon`  — the day before the due date, once.
 * - `due_today` — on the due date, once.
 * - `overdue`   — every day at first, then easing to every 3rd day after a week,
 *                 so a forgotten item keeps nagging without becoming noise the
 *                 recipient filters out. Stops after `OVERDUE_REMINDER_DAYS`:
 *                 a month of unanswered mail is a person problem for an admin
 *                 (the cron escalates), not something a 31st e-mail fixes.
 */
export const OVERDUE_REMINDER_DAYS = 30;

export function reminderFor(span: ReservationSpan, today: string): ReminderKind | null {
  if (!isBlocking(span.status)) return null;
  const due = dueDateOf(span);
  const delta = daysBetween(due, today);

  if (delta === -1) return "due_soon";
  if (delta === 0) return "due_today";
  if (delta < 0) return null;
  if (delta > OVERDUE_REMINDER_DAYS) return null;
  if (delta <= 7) return "overdue";
  return delta % 3 === 0 ? "overdue" : null;
}


/* -------------------------------------------------------------------------- */
/* Holder claims                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Normalises a holder label or a person's name for comparison: lower-cased,
 * accent-folded, punctuation dropped, whitespace collapsed. So "Wataru",
 * "wataru " and "Wataru." are one key, and the alias table stays
 * case-insensitive without needing the citext extension.
 */
export function normalizeHolderLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The name tokens that identify a person: their first and last name.
 *
 * Middle names are dropped on purpose — matching on one is far more likely to
 * be a coincidence than a match. Tokens under three characters are dropped too:
 * an initial ("J", "Ph") identifies nobody.
 */
export function nameTokens(raw: string): { first: string | null; last: string | null } {
  const parts = normalizeHolderLabel(raw).split(" ").filter((t) => t.length >= 3);
  if (parts.length === 0) return { first: null, last: null };
  return {
    first: parts[0],
    last: parts.length > 1 ? parts[parts.length - 1] : null,
  };
}

/**
 * Whether `label` plausibly refers to the person identified by `name` / `email`.
 *
 * Matches when a FIRST or LAST name is shared, in either position — so an
 * account for "Emil Wallnofer" matches the sheet's "Emil", its "Wallnofer", and
 * its "Emil Wallnofer". That looseness is deliberate and necessary: the sheet
 * spells people inconsistently, and requiring the whole name to line up would
 * strand exactly the people this exists to onboard.
 *
 * The safeguard against a loose match is NOT here — it is at the call site,
 * which auto-links only when exactly ONE unclaimed name matches. Two colleagues
 * called Philipp both match "Philipp", so neither is linked automatically and
 * the person is asked instead.
 *
 * The email local part is used as a fallback identity when the account has no
 * display name ("emil.wallnofer@" -> emil / wallnofer).
 */
export function holderLabelMatchesPerson(
  label: string,
  person: { name?: string | null; email?: string | null },
): boolean {
  const target = nameTokens(label);
  if (!target.first) return false;

  const targetSet = new Set([target.first, target.last].filter(Boolean) as string[]);

  const identities = [person.name, person.email ? person.email.split("@")[0] : null];
  for (const identity of identities) {
    if (!identity) continue;
    const mine = nameTokens(identity);
    for (const token of [mine.first, mine.last]) {
      if (token && targetSet.has(token)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Holder colours                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Palette for colouring the fleet by person.
 *
 * The previous twelve were named for twelve Tailwind hues but were not twelve
 * colours: sky, teal, cyan and emerald are four blue-greens, rose, pink and
 * fuchsia are three pinks, violet and indigo are the same blue-purple, and
 * amber and orange differ by about fifteen degrees of hue. On screen that was
 * five or six telling-apart-able colours doing the work of twelve.
 *
 * These fourteen are spaced around the wheel with no gap under ~25°, and the
 * two pairs that sit closest in hue are separated on a second axis instead:
 * `brown` is `orange` at a third of the chroma, and `steel` is `sky` at a
 * sixth. Two colours that differ on two axes survive being small, being
 * rendered at 55% alpha, and being looked at quickly — which is all this
 * palette ever does.
 *
 * Every entry stays light enough to carry the near-black text the calendar
 * prints on a booked cell, in both themes.
 *
 * Stored as space-separated RGB channels so a cell can vary only the alpha — a
 * live booking, a finished one and an unclaimed one are the same hue at
 * different weights, which keeps "who" and "what state" on separate channels.
 */
export const HOLDER_COLORS: ReadonlyArray<{ name: string; rgb: string }> = [
  { name: "red", rgb: "228 70 88" },
  { name: "orange", rgb: "240 130 40" },
  { name: "amber", rgb: "240 214 90" },
  { name: "olive", rgb: "168 180 55" },
  { name: "green", rgb: "106 191 89" },
  { name: "emerald", rgb: "45 186 134" },
  { name: "teal", rgb: "72 187 200" },
  { name: "sky", rgb: "90 150 245" },
  { name: "violet", rgb: "150 110 240" },
  { name: "magenta", rgb: "226 108 214" },
  { name: "pink", rgb: "250 140 165" },
  { name: "plum", rgb: "190 90 140" },
  // The two low-chroma entries. Muting is what lets them sit next to the
  // saturated hue they share a wedge with and still read as a different colour:
  // brown is orange at a third of the chroma, steel is sky at a sixth.
  { name: "brown", rgb: "181 137 100" },
  { name: "steel", rgb: "148 163 184" },
];

/**
 * Stable colour index for a holder.
 *
 * Deterministic and derived only from the name, so a person keeps the same
 * colour across reloads, across the calendar and the legend, and regardless of
 * who else happens to be on screen — an index into a sorted list of the current
 * window's holders would reshuffle every time someone books something.
 *
 * FNV-1a over the normalised label: same person, one colour, whether the sheet
 * wrote "Emil" or "Emil Wallnofer".
 */
export function holderColorIndex(label: string): number {
  const key = normalizeHolderLabel(label);
  if (!key) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    // FNV prime, via shifts so this stays in 32-bit integer arithmetic.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % HOLDER_COLORS.length;
}

/**
 * The RGB channels for a holder, ready to drop into `rgb(... / alpha)`.
 *
 * The un-allocated fallback: correct for one name in isolation, but it can hand
 * two people the same colour. Anything rendering a LIST of people should use
 * `assignHolderColors` instead — see there for why.
 */
export function holderRgb(label: string): string {
  return HOLDER_COLORS[holderColorIndex(label)].rgb;
}

/**
 * Give every person on the board a colour of their own.
 *
 * Hashing a name straight onto the palette is stable and needs no coordination,
 * which is why it was the first thing here — but `hash % 14` has no idea what
 * other names exist, so it collides. With a dozen holders the odds of at least
 * one clash are better than nine in ten, and two people sharing a colour is
 * worse than any amount of similarity between two colours: it makes the board
 * say something false about who has what.
 *
 * So the colour is allocated against the roster rather than derived from the
 * name alone. Each person asks for their hashed colour; if it is taken, they
 * walk forward to the next free one. Two properties fall out:
 *
 *   - **Nobody on screen shares**, up to the size of the palette.
 *   - **It is deterministic**: same roster in, same colours out, whatever order
 *     the names arrived in, on the server and in the browser alike.
 *
 * The cost is that a NEW person can displace someone — if they hash to a taken
 * slot and sort earlier, the person who had it moves along. That is a colour
 * changing on the day a colleague joins the fleet, which is a far smaller
 * problem than two people wearing one colour every day.
 *
 * Past `HOLDER_COLORS.length` people the pigeonhole wins and colours repeat.
 * The wrap is deliberately half a palette away from the name that shares it, so
 * the two that do collide are at least on opposite sides of the wheel.
 */
export function assignHolderColors(labels: Iterable<string>): Map<string, string> {
  const size = HOLDER_COLORS.length;
  // Normalised, de-duplicated and sorted: "Emil", "emil " and "EMIL" are one
  // person, and the sort is what makes the result independent of input order.
  const keys = [...new Set([...labels].map(normalizeHolderLabel).filter(Boolean))].sort();

  const taken = new Array<boolean>(size).fill(false);
  const byKey = new Map<string, string>();

  for (const [position, key] of keys.entries()) {
    const preferred = holderColorIndex(key);
    let index = preferred;
    for (let step = 0; step < size; step += 1) {
      const candidate = (preferred + step) % size;
      if (!taken[candidate]) {
        index = candidate;
        break;
      }
    }
    if (taken[index]) {
      // Every colour is spoken for. Repeat one, half a wheel from the name that
      // already holds it, so the unavoidable clash is at least a loud one.
      index = (preferred + Math.floor(size / 2) + position) % size;
    }
    taken[index] = true;
    byKey.set(key, HOLDER_COLORS[index].rgb);
  }

  return byKey;
}

/* -------------------------------------------------------------------------- */
/* Panel copy                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How a due date reads to the person holding the material.
 *
 * The calendar already shows the exact day; what this answers is the question
 * behind it — "is this mine to deal with today?" — so the wording leans on
 * today/tomorrow rather than a date the reader has to subtract from.
 */
export function dueLabel(dueDate: string, today: string): string {
  const delta = daysBetween(today, dueDate);
  if (delta < 0) return `${-delta} day${delta === -1 ? "" : "s"} overdue`;
  if (delta === 0) return "due back today";
  if (delta === 1) return "due back tomorrow";
  return `due back in ${delta} days`;
}

