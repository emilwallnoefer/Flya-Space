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
  /** Units of the same model that are free, when the refusal is a clash: pooled ones to book, assigned ones to ask for. */
  alternatives: ReadonlyArray<{ name: string; assigned?: boolean; holder?: string | null }> = [],
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
      const free = alternatives.filter((a) => !a.assigned).map((a) => a.name);
      const assigned = alternatives.filter((a) => a.assigned);
      const parts: string[] = [];
      if (free.length > 0) {
        const list = free.length <= 2 ? free.join(" and ") : `${free.slice(0, 2).join(", ")} and ${free.length - 2} more`;
        parts.push(`${list} ${free.length === 1 ? "is" : "are"} free for those days`);
      }
      if (assigned.length > 0) {
        const list =
          assigned.length <= 2
            ? assigned.map((a) => `${a.name}${a.holder ? ` (${a.holder})` : ""}`).join(" and ")
            : `${assigned.slice(0, 2).map((a) => a.name).join(", ")} and ${assigned.length - 2} more`;
        parts.push(`${list} ${assigned.length === 1 ? "is" : "are"} assigned and can be asked for`);
      }
      if (parts.length === 0) return `${base} You can join the waitlist instead.`;
      return `${base} ${parts.join("; ")} — or join the waitlist.`;
    }
  }
}
