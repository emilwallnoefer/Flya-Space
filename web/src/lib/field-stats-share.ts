import type { PilotWorkdays } from "@/lib/field-stats";

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
