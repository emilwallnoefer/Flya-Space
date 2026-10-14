/**
 * @-mentions in Team chat, the pure part: finding the token being typed,
 * matching it against the team, and resolving the names in a finished message
 * back to people. Shared by the browser (the composer's picker, the message
 * renderer) and the server (the mention notification route), so it imports
 * nothing from either.
 *
 * A mention is the literal text `@Full Name` in the body — no markup, no ids
 * stored — so the message reads the same everywhere, including in a push
 * notification or an old client. Names come from the sign-in provider via
 * `displayNameFor()` on the server (never from user-writable metadata).
 */

export type ChatMember = {
  id: string;
  /** The person's name as the picker shows it and as it appears in the body. */
  name: string;
  email: string;
};

/** The `@…` token the caret is in, or null when the caret is not in one. */
export type MentionToken = {
  /** Index of the `@` in the draft. */
  start: number;
  /** Index just past the token (the caret). */
  end: number;
  /** Text after the `@`, as typed. */
  query: string;
};

/** Mentions longer than this cannot be a name; the picker closes. */
const MAX_QUERY_LENGTH = 40;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Finds a mention being typed: an `@` at the start or after whitespace, with
 * no newline or second `@` between it and the caret. The query may contain
 * spaces (names do), so "@Emil Wa" is one token; whether it is still a
 * mention is decided by `matchMembers` finding candidates for it.
 */
export function mentionTokenAtCaret(draft: string, caret: number): MentionToken | null {
  const before = draft.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH || query.includes("\n")) return null;
  // Two spaces in a row means the writer has moved on from the name.
  if (/\s{2}/.test(query)) return null;
  return { start: at, end: caret, query };
}

/**
 * Members whose name (any word of it) or email starts with the query, the
 * whole-name matches first. An empty query lists everyone. The caller
 * excludes themselves if it wants to.
 */
export function matchMembers(members: readonly ChatMember[], query: string, limit = 6): ChatMember[] {
  const q = fold(query.trim());
  const scored: Array<{ member: ChatMember; score: number }> = [];
  for (const member of members) {
    const name = fold(member.name);
    const email = fold(member.email);
    let score = -1;
    if (q.length === 0) score = 1;
    else if (name.startsWith(q)) score = 3;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 2;
    else if (email.startsWith(q)) score = 1;
    if (score >= 0) scored.push({ member, score });
  }
  scored.sort((a, b) => b.score - a.score || a.member.name.localeCompare(b.member.name));
  return scored.slice(0, limit).map((s) => s.member);
}

/** The draft with the token replaced by the chosen name, and where the caret lands. */
export function insertMention(draft: string, token: MentionToken, member: ChatMember): { draft: string; caret: number } {
  const insertion = `@${member.name} `;
  const next = draft.slice(0, token.start) + insertion + draft.slice(token.end);
  return { draft: next, caret: token.start + insertion.length };
}

/**
 * Ids of the members a finished body mentions. A match is `@` + the full name,
 * case- and accent-insensitive, followed by nothing or a non-letter — so
 * "@Emil" does not count as a mention of "Emil Wallnöfer" (the picker always
 * inserts the full name), and "@Anna" is not "@Annabel".
 */
export function mentionedMemberIds(body: string | null | undefined, members: readonly ChatMember[]): string[] {
  if (!body || !body.includes("@")) return [];
  const folded = fold(body);
  const ids: string[] = [];
  for (const member of members) {
    const needle = `@${fold(member.name)}`;
    let from = 0;
    while (from <= folded.length) {
      const i = folded.indexOf(needle, from);
      if (i < 0) break;
      const after = folded[i + needle.length];
      if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) {
        ids.push(member.id);
        break;
      }
      from = i + 1;
    }
  }
  return ids;
}

/**
 * Splits a body into plain text and mention segments for rendering, using the
 * same rule as `mentionedMemberIds`. Longer names win where one is a prefix of
 * another.
 */
export function splitMentions(
  body: string,
  members: readonly ChatMember[],
): Array<{ type: "text"; value: string } | { type: "mention"; value: string; member: ChatMember }> {
  if (!body.includes("@") || members.length === 0) return [{ type: "text", value: body }];
  const folded = fold(body);
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
  const out: Array<{ type: "text"; value: string } | { type: "mention"; value: string; member: ChatMember }> = [];
  let i = 0;
  let textStart = 0;
  while (i < body.length) {
    if (body[i] !== "@") {
      i += 1;
      continue;
    }
    let hit: ChatMember | null = null;
    for (const member of byLength) {
      const needle = fold(member.name);
      if (!folded.startsWith(needle, i + 1)) continue;
      const after = folded[i + 1 + needle.length];
      if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) {
        hit = member;
        break;
      }
    }
    if (!hit) {
      i += 1;
      continue;
    }
    // `fold` keeps length for the characters we care about (NFD strips marks,
    // but they are not in the folded names either), so slice from the original.
    const end = i + 1 + hit.name.length;
    if (i > textStart) out.push({ type: "text", value: body.slice(textStart, i) });
    out.push({ type: "mention", value: body.slice(i, end), member: hit });
    i = end;
    textStart = end;
  }
  if (textStart < body.length) out.push({ type: "text", value: body.slice(textStart) });
  return out;
}

/** A one-line excerpt of a message for quotes and notifications. */
export function excerpt(body: string | null | undefined, attachmentName?: string | null, max = 140): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  if (attachmentName) return `Attachment: ${attachmentName}`;
  return "";
}
