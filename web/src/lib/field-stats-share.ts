import type { FieldDay, PilotWorkdays } from "@/lib/field-stats";

/**
 * The team's running balance, day by day: each pilot on the road that day adds
 * one, each pilot at home takes one away. Rising means more travel than home.
 */
export function runningBalance(days: readonly FieldDay[]): (FieldDay & { balance: number })[] {
  let balance = 0;
  return days.map((day) => {
    balance += day.travel - day.home;
    return { ...day, balance };
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
