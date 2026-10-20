/**
 * Rules for the Day Logger's 24-hour time field: an hours box and a minutes
 * box, typed into the way the browser's own time field works, but never with
 * AM/PM (the native box follows the computer's clock setting, and on 12-hour
 * machines people kept saving PM times they meant as AM). Values in and out
 * are `HH:MM`, the format the time tracker stores, or "" for no time.
 */

export type Segment = "h" | "m";

const MAX: Record<Segment, number> = { h: 23, m: 59 };

const pad = (n: number) => String(n).padStart(2, "0");

/** Splits a stored `HH:MM` into the two boxes; anything else is empty. */
export function splitTime(value: string): { h: string; m: string } {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { h: "", m: "" };
  return { h: match[1], m: match[2] };
}

/**
 * The value the boxes stand for: `HH:MM` when both hold a number, "" when both
 * are empty, and null while only one is filled in (nothing to save yet).
 */
export function joinTime(h: string, m: string): string | null {
  if (h === "" && m === "") return "";
  if (h === "" || m === "") return null;
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * One digit typed into a box. `fresh` means the box was just entered or is
 * already complete, so the digit starts over instead of appending. `done`
 * tells the field to move on: after two digits, or after one that can't be
 * followed by another (3–9 in the hours, 6–9 in the minutes).
 */
export function typeDigit(
  segment: Segment,
  current: string,
  fresh: boolean,
  digit: number,
): { text: string; done: boolean } {
  const firstMax = Math.floor(MAX[segment] / 10);
  const start = () =>
    digit > firstMax ? { text: pad(digit), done: true } : { text: String(digit), done: false };
  if (fresh || current.length !== 1) return start();
  const combined = Number(current) * 10 + digit;
  if (combined > MAX[segment]) return start();
  return { text: pad(combined), done: true };
}

/** Arrow keys: one step up or down in a box, wrapping around. An empty box
 * starts at 08 for hours and 00 for minutes. */
export function stepSegment(segment: Segment, current: string, delta: number): string {
  if (current === "") return segment === "h" ? "08" : "00";
  const size = MAX[segment] + 1;
  return pad((((Number(current) + delta) % size) + size) % size);
}

/** A box's text as it should read once the person has left it. */
export function padSegment(text: string): string {
  return text === "" ? "" : pad(Number(text));
}

/** Every quarter hour of the day, for the picker list. */
export const QUARTER_HOURS: readonly string[] = Array.from({ length: 96 }, (_, i) =>
  `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`,
);

/** The picker row to show first: the value itself if it is on the list,
 * otherwise the quarter hour just before it, otherwise 08:00. */
export function nearestQuarterHour(value: string): string {
  const { h, m } = splitTime(value);
  if (h === "") return "08:00";
  return `${h}:${pad(Math.floor(Number(m) / 15) * 15)}`;
}
