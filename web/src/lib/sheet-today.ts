import { parseDateFromMonthYearDay, parseFullDate } from "@/lib/google-sheets";

/**
 * Finds today's cell in a calendar-shaped tab, so an embedded sheet can open
 * scrolled to it (`#gid=…&range=<cell>`). Pure — the sheet read lives in
 * `google-embed-today.ts`, and `today` (YYYY-MM-DD) is passed in.
 *
 * Two layouts exist:
 * - rows: one row per day, the month ("January 2026") in column A on the first
 *   row of each month and the day number in column C. That is "Mission
 *   planning", and the same carry-down `field-stats.ts` uses.
 * - columns: one column per day, the month along one of the top rows (written
 *   once per month and carried right) and the day number in a row below it.
 *   That is the fleet sheet's roadshow planning.
 *
 * Month labels are typed by hand and some are missing (the fleet sheet had no
 * "October 2026", so October read as a second September). The day numbers are
 * the reliable part: when they start over without a new label, that is the
 * next month.
 */

function text(row: readonly unknown[] | undefined, index: number): string {
  return String(row?.[index] ?? "").trim();
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Walks a calendar one day cell at a time: `step(label, day)` takes the month
 * label beside the day (often blank) and the day number, and returns the date
 * it stands for, or null for a cell that is not a day.
 */
export function calendarWalker() {
  let year = 0;
  let month = 0;
  let previousDay = 0;
  return (label: string, dayRaw: string): string | null => {
    const labelled = label ? parseDateFromMonthYearDay(label, "1") : null;
    if (labelled) {
      year = Number(labelled.slice(0, 4));
      month = Number(labelled.slice(5, 7));
      previousDay = 0;
    }
    if (!/^\d{1,2}$/.test(dayRaw)) return null;
    const day = Number(dayRaw);
    if (day < 1 || day > 31 || !month) return null;
    // Strictly smaller: a repeated day ("28, 28") is a typo, not a new month.
    if (day < previousDay) {
      month = month === 12 ? 1 : month + 1;
      if (month === 1) year += 1;
    }
    previousDay = day;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
}

/** `rows` starts at sheet row 1. Returns e.g. "A3204", or null when today has no row. */
export function findTodayRowCell(rows: readonly (readonly unknown[])[], today: string): string | null {
  const step = calendarWalker();
  for (let i = 0; i < rows.length; i += 1) {
    const monthYear = text(rows[i], 0);
    const fullDate = parseFullDate(monthYear);
    const date = fullDate ?? step(monthYear, text(rows[i], 2));
    if (date === today) return `A${i + 1}`;
  }
  return null;
}

/** How far down the month and day header rows may sit. */
const HEADER_ROWS = 6;

/**
 * `rows` starts at sheet row 1 and holds at least the header rows. Returns the
 * day-number cell of today's column, e.g. "KQ2", or null when no column is today.
 */
export function findTodayColumnCell(rows: readonly (readonly unknown[])[], today: string): string | null {
  const last = Math.min(rows.length, HEADER_ROWS);
  // A row of real dates ("06.10.2026", added to the fleet sheet for this) wins
  // over the hand-typed month labels.
  for (let row = 0; row < last; row += 1) {
    const width = rows[row]?.length ?? 0;
    for (let col = 0; col < width; col += 1) {
      if (parseFullDate(text(rows[row], col)) === today) return `${columnLetter(col)}${row + 1}`;
    }
  }
  for (let monthRow = 0; monthRow < last; monthRow += 1) {
    for (let dayRow = monthRow + 1; dayRow < last; dayRow += 1) {
      const width = Math.max(rows[monthRow]?.length ?? 0, rows[dayRow]?.length ?? 0);
      const step = calendarWalker();
      for (let col = 0; col < width; col += 1) {
        if (step(text(rows[monthRow], col), text(rows[dayRow], col)) === today) {
          return `${columnLetter(col)}${dayRow + 1}`;
        }
      }
    }
  }
  return null;
}
