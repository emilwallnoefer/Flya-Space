/**
 * Rules for a leaderboard score that could not be posted yet.
 *
 * A run flown offline — on the offline page, or in the dashboard after the
 * connection dropped — still counts. Its score is kept in localStorage and
 * posted the next time the app is online. Pure: no storage, no fetch; the I/O
 * lives in `lib/elios-score-sync.ts`.
 *
 * Only ONE pending score is ever kept, the highest. The board records a
 * player's best and refuses anything that is not an improvement, so posting
 * every offline crash would change nothing but the request count.
 */
import { MAX_PLAUSIBLE_SCORE } from "@/lib/elios-leaderboard";

/** Versioned with ELIOS_RULES_VERSION, so a score queued under older rules is never sent. */
export const PENDING_SCORE_KEY = "elios:pending-score-v2";

/** Anything that is not a score the server would accept is treated as nothing pending. */
export function parsePendingScore(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PLAUSIBLE_SCORE) return null;
  return value;
}

/** Keep whichever is higher — a worse run must never displace a better one waiting to go. */
export function mergePendingScore(current: number | null, score: number): number | null {
  if (!Number.isInteger(score) || score <= 0 || score > MAX_PLAUSIBLE_SCORE) return current;
  return current === null || score > current ? score : current;
}

/**
 * What to do with the pending score after a POST came back with `status`.
 *
 * - `clear`: the server has made its decision (recorded it, or it was not an
 *   improvement). Either way it is done.
 * - `drop`: the server says the score itself is nonsense. Retrying will never
 *   help, so forget it rather than resend it forever.
 * - `keep`: nobody was signed in, the rate limit hit, or the server failed.
 *   Every one of those can come right later, so try again next time.
 */
export type PendingOutcome = "clear" | "drop" | "keep";

export function pendingOutcome(status: number): PendingOutcome {
  if (status >= 200 && status < 300) return "clear";
  if (status === 400) return "drop";
  return "keep";
}
