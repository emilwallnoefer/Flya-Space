/**
 * Rules for the Friday-evening "nothing logged this week" phone reminder.
 * Pure: no clock, no database — the cron route feeds it the parts.
 */

export const REMINDER_TIMEZONE = "Europe/Zurich";
/** Local hour (0–23) in `REMINDER_TIMEZONE` at which the reminder goes out. */
export const REMINDER_HOUR = 19;
export const WEEK_UNLOGGED_KIND = "week_unlogged";

export type ZurichParts = {
  /** "Mon" … "Sun" */
  weekday: string;
  hour: number;
  minute: number;
  /** YYYY-MM-DD in Zurich */
  date: string;
};

export function zurichParts(now: Date): ZurichParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REMINDER_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  // `hour12: false` yields "24" at midnight in some engines.
  const hour = Number.parseInt(map.hour ?? "0", 10) % 24;
  return {
    weekday: map.weekday ?? "",
    hour,
    minute: Number.parseInt(map.minute ?? "0", 10),
    date: `${map.year}-${map.month}-${map.day}`,
  };
}

/** True inside the one hour of the week the cron is meant to act in. */
export function isReminderWindow(parts: ZurichParts): boolean {
  return parts.weekday === "Fri" && parts.hour === REMINDER_HOUR;
}

/**
 * Monday…Friday of the week that contains `date` (YYYY-MM-DD), as date strings.
 * Pure calendar arithmetic on the string, so the server's own timezone never
 * leaks in.
 */
export function workWeekOf(date: string): { start: string; end: string } {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  const utc = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - sinceMonday);
  const start = utc.toISOString().slice(0, 10);
  utc.setUTCDate(utc.getUTCDate() + 4);
  const end = utc.toISOString().slice(0, 10);
  return { start, end };
}

export type DayLogRow = {
  net_mins: number | null;
  holiday: boolean | null;
  public_holiday: boolean | null;
  sick_leave: boolean | null;
};

/**
 * "Logged a day" means the tracker holds anything meaningful for it: worked
 * minutes, or the day marked as vacation, public holiday or sick leave. An
 * empty row (a sheet opened and closed) does not count. A comp adjustment on
 * any day of the week counts too — it is a deliberate entry.
 */
export function hasLoggedAnyDay(days: readonly DayLogRow[], compAdjustments = 0): boolean {
  if (compAdjustments > 0) return true;
  return days.some(
    (day) =>
      (day.net_mins ?? 0) > 0 || day.holiday === true || day.public_holiday === true || day.sick_leave === true,
  );
}

export function weekUnloggedPayload(name: string | null) {
  const greeting = name ? `${name}, ` : "";
  return {
    title: "No hours logged this week",
    body: `${greeting}your time sheet for this week is still empty. Take a minute to fill in your days.`,
    url: "/dashboard?module=time",
    tag: WEEK_UNLOGGED_KIND,
  };
}
