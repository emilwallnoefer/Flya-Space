import type { FieldDay, PilotWorkdays } from "@/lib/field-stats";

/** How many workdays the day-by-day line averages over: two working weeks. */
export const DAILY_WINDOW_WORKDAYS = 10;

const round3 = (n: number) => +n.toFixed(3);

/**
 * An SVG path through every point as a smooth curve that never overshoots
 * (monotone cubic, as d3's curveMonotoneX): a flat stretch stays flat and the
 * curve never leaves the range of its neighbours, so it can't dip below zero.
 * Points must be ordered by x.
 */
export function smoothPath(points: readonly { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  const move = `M${round3(points[0].x)},${round3(points[0].y)}`;
  if (n === 1) return move;

  const slope = (i: number) => (points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x || 1);
  const tangents = points.map((_, i) => {
    if (i === 0 || i === n - 1) return Number.NaN;
    const h0 = points[i].x - points[i - 1].x || 1;
    const h1 = points[i + 1].x - points[i].x || 1;
    const s0 = slope(i - 1);
    const s1 = slope(i);
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  });
  // Ends: lean towards the neighbouring tangent, as d3 does.
  const end = (i: number, neighbour: number, s: number) =>
    n === 2 ? s : (3 * s - (Number.isNaN(tangents[neighbour]) ? s : tangents[neighbour])) / 2;
  tangents[0] = end(0, 1, slope(0));
  tangents[n - 1] = end(n - 1, n - 2, slope(n - 2));

  const segments = [move];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const third = (b.x - a.x) / 3;
    segments.push(
      `C${round3(a.x + third)},${round3(a.y + tangents[i] * third)} ${round3(b.x - third)},${round3(
        b.y - tangents[i + 1] * third,
      )} ${round3(b.x)},${round3(b.y)}`,
    );
  }
  return segments.join(" ");
}

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
