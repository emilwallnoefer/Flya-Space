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

/** `rows` starts at sheet row 1. Returns e.g. "A3204", or null when today has no row. */
export function findTodayRowCell(rows: readonly (readonly unknown[])[], today: string): string | null {
  let activeMonthYear = "";
  for (let i = 0; i < rows.length; i += 1) {
    const monthYear = text(rows[i], 0);
    const fullDate = parseFullDate(monthYear);
    if (!fullDate && monthYear) activeMonthYear = monthYear;
    const date = fullDate ?? parseDateFromMonthYearDay(activeMonthYear, text(rows[i], 2));
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
  for (let monthRow = 0; monthRow < last; monthRow += 1) {
    for (let dayRow = monthRow + 1; dayRow < last; dayRow += 1) {
      const width = Math.max(rows[monthRow]?.length ?? 0, rows[dayRow]?.length ?? 0);
      let activeMonthYear = "";
      for (let col = 0; col < width; col += 1) {
        const label = text(rows[monthRow], col);
        if (label && parseDateFromMonthYearDay(label, "1")) activeMonthYear = label;
        const date = parseDateFromMonthYearDay(activeMonthYear, text(rows[dayRow], col));
        if (date === today) return `${columnLetter(col)}${dayRow + 1}`;
      }
    }
  }
  return null;
}
