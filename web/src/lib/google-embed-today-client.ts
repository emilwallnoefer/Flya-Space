import type { EmbedSheet } from "@/lib/google-embeds";

/**
 * Today's cell for an embedded calendar sheet, asked for once per sheet per
 * day and shared by everyone who wants it. The dashboard starts the request as
 * soon as it mounts, so by the time a pilot clicks "Mission planning" the
 * answer is usually already here and the frame opens on today straight away.
 *
 * Resolves to null on any failure: the sheet then simply opens at its top.
 */
const pending = new Map<string, Promise<string | null>>();

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function todayCell(sheet: EmbedSheet): Promise<string | null> {
  const key = `${sheet}:${localDay()}`;
  let promise = pending.get(key);
  if (!promise) {
    promise = fetch(`/api/google-embeds/today?sheet=${sheet}`)
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (body: { cell?: string | null } | null) => body?.cell ?? null,
        () => null,
      );
    // A failed lookup is asked again next time rather than remembered.
    promise.then((cell) => {
      if (cell === null) pending.delete(key);
    });
    pending.set(key, promise);
  }
  return promise;
}
