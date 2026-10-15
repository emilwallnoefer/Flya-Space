/**
 * Emoji reactions on team-chat messages: the allowed set and the pure
 * reducers. The table is `chat_message_reactions`
 * (`supabase/2026-10-15-chat-reactions.sql`), whose check constraint (latest:
 * `2026-10-15-chat-reactions-fire.sql`) lists the
 * same emoji — change both together.
 */

export const CHAT_REACTIONS = ["👍", "❤️", "😂", "🔥", "😮", "🙏"] as const;
export type ChatReactionEmoji = (typeof CHAT_REACTIONS)[number];

export function isChatReaction(value: unknown): value is ChatReactionEmoji {
  return typeof value === "string" && (CHAT_REACTIONS as readonly string[]).includes(value);
}

export type ChatReactionRow = {
  message_id: string;
  user_id: string;
  emoji: string;
};

export type ReactionGroup = {
  emoji: ChatReactionEmoji;
  /** Who reacted, in the order they did. */
  userIds: string[];
  /** Whether the viewer is one of them. */
  mine: boolean;
};

export function sameReaction(a: ChatReactionRow, b: ChatReactionRow): boolean {
  return a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji;
}

/** Add a row unless it is already there (an optimistic add meeting its realtime echo). */
export function addReaction(rows: ChatReactionRow[], row: ChatReactionRow): ChatReactionRow[] {
  return rows.some((r) => sameReaction(r, row)) ? rows : [...rows, row];
}

export function removeReaction(rows: ChatReactionRow[], row: ChatReactionRow): ChatReactionRow[] {
  const next = rows.filter((r) => !sameReaction(r, row));
  return next.length === rows.length ? rows : next;
}

/** Merge freshly fetched rows into the held ones, keeping each reaction once. */
export function mergeReactions(rows: ChatReactionRow[], incoming: ChatReactionRow[]): ChatReactionRow[] {
  let next = rows;
  for (const row of incoming) next = addReaction(next, row);
  return next;
}

/**
 * Per message, the reactions grouped by emoji in `CHAT_REACTIONS` order, so a
 * chip never jumps sideways when someone else reacts. Unknown emoji (a row
 * written before the set changed) are skipped.
 */
export function summarizeReactions(
  rows: ChatReactionRow[],
  currentUserId: string | null,
): Map<string, ReactionGroup[]> {
  const byMessage = new Map<string, Map<ChatReactionEmoji, string[]>>();
  for (const row of rows) {
    if (!isChatReaction(row.emoji)) continue;
    let groups = byMessage.get(row.message_id);
    if (!groups) {
      groups = new Map();
      byMessage.set(row.message_id, groups);
    }
    const users = groups.get(row.emoji) ?? [];
    if (!users.includes(row.user_id)) users.push(row.user_id);
    groups.set(row.emoji, users);
  }
  const out = new Map<string, ReactionGroup[]>();
  for (const [messageId, groups] of byMessage) {
    const list: ReactionGroup[] = [];
    for (const emoji of CHAT_REACTIONS) {
      const userIds = groups.get(emoji);
      if (!userIds || userIds.length === 0) continue;
      list.push({ emoji, userIds, mine: currentUserId != null && userIds.includes(currentUserId) });
    }
    if (list.length > 0) out.set(messageId, list);
  }
  return out;
}
