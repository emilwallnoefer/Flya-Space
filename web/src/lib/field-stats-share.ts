import type { FieldDay, PilotWorkdays } from "@/lib/field-stats";

/** How many workdays the day-by-day line averages over: one working week. */
export const DAILY_WINDOW_WORKDAYS = 5;

/**
 * Team travel for every workday, averaged over the last `window` workdays so
 * the line moves every day without jumping 0–5 from one day to the next: it
 * rises on travel days and falls on days at home. Count mode is pilots on the
 * road per day; % mode is the window's travel days over its workdays.
 */
export function dailyTravel(
  days: readonly FieldDay[],
  percent: boolean,
  window = DAILY_WINDOW_WORKDAYS,
): (FieldDay & { value: number })[] {
  return days.map((day, i) => {
    const recent = days.slice(Math.max(0, i - window + 1), i + 1);
    const travel = recent.reduce((acc, d) => acc + d.travel, 0);
    const workDays = recent.reduce((acc, d) => acc + d.travel + d.home, 0);
    const value = percent
      ? workDays > 0
        ? Math.round((travel / workDays) * 100)
        : 0
      : Math.round((travel / recent.length) * 10) / 10;
    return { ...day, value };
  });
}

/**
 * The whole team's share: everyone's days over everyone's workdays, so a pilot
 * with few workdays that period weighs less than one with many. Apart from
 * `field-stats.ts` because that module reaches server-only sheet code, and this
 * runs in the panel.
 */
export function teamShare(
  workdays: readonly PilotWorkdays[],
  field: "pocDays" | "trainingDays" | "travelDays",
): { days: number; workDays: number; percent: number } {
  const days = workdays.reduce((acc, w) => acc + w[field], 0);
  const workDays = workdays.reduce((acc, w) => acc + w.workDays, 0);
  return { days, workDays, percent: workDays > 0 ? Math.round((days / workDays) * 100) : 0 };
}
