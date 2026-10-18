import type { ConflictCheck } from "@/lib/fleet-rules";

/** A `checkReservation` result that refused the span. */
export type ReserveRefusal = Exclude<ConflictCheck, { ok: true }>;

/**
 * Turns a refused booking into the sentence the person sees.
 *
 * Pure, and kept next to `window.ts` rather than inside the handler so it can be
 * unit-tested: these strings are the only explanation anybody gets for why they
 * could not book, and the horizon one has to name their actual score.
 */
export function reserveErrorMessage(
  check: ReserveRefusal,
  reliability: { score: number; horizonDays: number },
  assetName: string,
  /** Free units of the same kind, when the refusal is a clash. */
  alternatives: ReadonlyArray<{ name: string }> = [],
): string {
  switch (check.reason) {
    case "inverted":
      return "The last day cannot be before the first.";
    case "past":
      return "That day is already past.";
    case "too_long":
      return `A single booking can run at most ${check.maxDays} days. Split it, or ask an admin.`;
    case "beyond_horizon":
      return `Your reliability score (${reliability.score}) lets you book up to ${check.horizonDays} days ahead. Return material on time to book further out.`;
    case "overlap": {
      const base = `${assetName} is already booked on those days.`;
      if (alternatives.length === 0) return `${base} You can join the waitlist instead.`;
      const names = alternatives.map((a) => a.name);
      const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
      return `${base} ${list} ${names.length === 1 ? "is" : "are"} free for those days — or join the waitlist.`;
    }
  }
}
