/**
 * Rules for the "Fly where people can't" leaderboard.
 *
 * Pure: no Supabase, no `Date.now()`. The route does the I/O, this decides what
 * counts.
 *
 * A caveat worth keeping in view: the score is produced in the player's
 * browser and posted to us, so it is spoofable by anyone who opens devtools.
 * This is a board for a team of colleagues, not a record, and nothing depends
 * on it. `MAX_PLAUSIBLE_SCORE` exists to keep a joke submission from sitting at
 * the top forever, not to make cheating impossible — it cannot.
 */

/** Above this, a submission is a joke rather than a flight. */
export const MAX_PLAUSIBLE_SCORE = 999;

export const LEADERBOARD_LIMIT = 10;

/**
 * Which rules a score was flown under. Bump it whenever a change makes old
 * scores incomparable (the speed curve, the collision-tolerant opening), and
 * clear `elios_scores` in the same release. The route refuses any other
 * version — including none, which is what a tab still running the previous
 * build sends — so an old-rules score cannot land on the fresh board.
 *
 *   1  original run, linear speed-up to 148
 *   2  three-phase curve to 185, cage bounces below 2 m/s (2026-10-02)
 */
export const ELIOS_RULES_VERSION = 2;

export type LeaderboardRow = {
  /** First name only — this is a wall display, not a directory. */
  name: string;
  score: number;
  /** True for the row belonging to the person looking at it. */
  you?: boolean;
};

/**
 * The first name, from whatever the account actually has.
 *
 * `displayNameFor` already falls back from full name to a title-cased email
 * local part, so this only has to take the first word of that and keep it
 * sane — a pasted full row of text should not stretch the board.
 */
export function firstNameOf(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  if (!first) return "Someone";
  return first.length > 18 ? `${first.slice(0, 17)}…` : first;
}

/**
 * Is this submission worth writing?
 *
 * Only an improvement counts, so a bad run can never overwrite a good one —
 * the client posts every crash and the server decides.
 */
export function shouldRecord(score: number, current: number | null): boolean {
  if (!Number.isInteger(score) || score <= 0 || score > MAX_PLAUSIBLE_SCORE) return false;
  return current === null || score > current;
}

/** Was this submission flown under the rules the board is currently counting? */
export function isCurrentRules(raw: unknown): boolean {
  return raw === ELIOS_RULES_VERSION;
}

/** Coerce whatever arrived over the wire into a score, or null if it is nonsense. */
export function parseSubmittedScore(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded <= 0 || rounded > MAX_PLAUSIBLE_SCORE) return null;
  return rounded;
}

/**
 * Order the board: highest first, then earliest to reach that score, so a tie
 * goes to whoever got there first rather than shuffling on every read.
 */
export function rankBoard(
  rows: ReadonlyArray<{ name: string; score: number; achievedAt: string; userId: string }>,
  viewerId: string | null,
  limit = LEADERBOARD_LIMIT,
): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => b.score - a.score || a.achievedAt.localeCompare(b.achievedAt))
    .slice(0, limit)
    .map((r) => ({
      name: firstNameOf(r.name),
      score: r.score,
      ...(viewerId && r.userId === viewerId ? { you: true } : {}),
    }));
}
