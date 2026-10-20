/**
 * Rules for the Day Logger's 24-hour time field. The field is plain text so it
 * reads the same in every browser and region (the native `type="time"` box
 * shows AM/PM on 12-hour machines, which people kept setting wrong). Values
 * in and out are always `HH:MM`, the format the time tracker stores.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function toKey(hours: number, minutes: number): string | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Keeps only digits and one colon, at most five characters (`HH:MM`). */
export function sanitizeTimeDraft(raw: string): string {
  let seenColon = false;
  let out = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if ((ch === ":" || ch === "." || ch === "h") && !seenColon && out.length > 0) {
      seenColon = true;
      out += ":";
    }
  }
  return out.slice(0, 5);
}

/**
 * A draft that is already a complete time while the person is still typing:
 * `7:30`, `07:30` or `0730`. Shorter drafts (`7`, `73`, `730`) wait for blur,
 * because they could still grow into something else.
 */
export function parseTimeLive(draft: string): string | null {
  const text = draft.trim();
  let m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return toKey(Number(m[1]), Number(m[2]));
  m = text.match(/^(\d{2})(\d{2})$/);
  if (m) return toKey(Number(m[1]), Number(m[2]));
  return null;
}

/**
 * The forgiving read used when the field loses focus: everything
 * `parseTimeLive` accepts, plus a bare hour (`7` → 07:00, `17` → 17:00), a
 * three-digit `730` → 07:30 and an hour with a trailing colon (`7:` → 07:00).
 */
export function parseTimeOnBlur(draft: string): string | null {
  const live = parseTimeLive(draft);
  if (live) return live;
  const text = draft.trim();
  let m = text.match(/^(\d{1,2}):?$/);
  if (m) return toKey(Number(m[1]), 0);
  m = text.match(/^(\d)(\d{2})$/);
  if (m) return toKey(Number(m[1]), Number(m[2]));
  m = text.match(/^(\d{1,2}):(\d)$/);
  if (m) return toKey(Number(m[1]), Number(m[2]) * 10);
  return null;
}

/** Moves an `HH:MM` value by `deltaMins`, wrapping around midnight. An empty
 * value starts from `fallback`. */
export function stepTime(value: string, deltaMins: number, fallback = "08:00"): string {
  const base = parseTimeLive(value) ?? fallback;
  const [h, m] = base.split(":").map(Number);
  const total = (((h * 60 + m + deltaMins) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Every quarter hour of the day, for the picker list. */
export const QUARTER_HOURS: readonly string[] = Array.from({ length: 96 }, (_, i) =>
  `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`,
);

/** The picker row to show first: the value itself if it is on the list,
 * otherwise the quarter hour just before it, otherwise 08:00. */
export function nearestQuarterHour(value: string): string {
  const key = parseTimeLive(value);
  if (!key) return "08:00";
  const [h, m] = key.split(":").map(Number);
  return `${pad(h)}:${pad(Math.floor(m / 15) * 15)}`;
}
