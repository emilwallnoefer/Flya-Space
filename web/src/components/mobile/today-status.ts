import { fmtHM, type DayData } from "@/components/time-tracker/types";
import { isWeekendDate } from "@/lib/time-tracker-rules";

export type TodayStatus = {
  /** The big word or number on the tile. */
  value: string;
  /** The short line under it. */
  sub: string;
  tone: "default" | "positive";
  /** True when there is nothing to log today, so the tile is a statement, not a nudge. */
  off: boolean;
};

/**
 * What the phone home's "Today" tile says. A day with hours shows them; a
 * weekend, vacation, public holiday or sick day says so, so an empty tile
 * never reads as "you forgot to log" when there was nothing to log; a day
 * paid from the overtime bank says it is compensated (next to the hours when
 * both exist); and a weekday with nothing yet is the one case that stays a
 * nudge.
 */
export function todayStatus(today: DayData | null, todayKey: string): TodayStatus {
  if (!today) return { value: "—", sub: "", tone: "default", off: false };
  const compMins = Math.max(0, today.comp_mins);
  if (today.net_mins > 0) {
    const span = `${today.start_time}–${today.stop_time}`;
    return { value: fmtHM(today.net_mins), sub: compMins > 0 ? `${span} · ${fmtHM(compMins)} comp` : span, tone: "positive", off: false };
  }
  if (compMins > 0) return { value: "Compensated", sub: fmtHM(compMins), tone: "positive", off: true };
  if (today.holiday) return { value: "Vacation", sub: "Day off", tone: "default", off: true };
  if (today.public_holiday) return { value: "Holiday", sub: "Day off", tone: "default", off: true };
  if (today.sick_leave) return { value: "Sick", sub: "Day off", tone: "default", off: true };
  if (isWeekendDate(todayKey)) return { value: "Weekend", sub: "Day off", tone: "default", off: true };
  return { value: "—", sub: "Not logged", tone: "default", off: false };
}
