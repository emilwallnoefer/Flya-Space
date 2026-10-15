import { describe, expect, it } from "vitest";
import {
  CHAT_REACTIONS,
  addReaction,
  isChatReaction,
  mergeReactions,
  removeReaction,
  summarizeReactions,
  type ChatReactionRow,
} from "./chat-reactions";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const r = (message_id: string, user_id: string, emoji: string): ChatReactionRow => ({ message_id, user_id, emoji });

describe("chat reactions", () => {
  it("accepts only the fixed set", () => {
    expect(isChatReaction("👍")).toBe(true);
    expect(isChatReaction("❤️")).toBe(true);
    expect(isChatReaction("💩")).toBe(false);
    expect(isChatReaction(null)).toBe(false);
  });

  it("matches the database check constraint", () => {
    const sql = readFileSync(join(__dirname, "../../supabase/2026-10-15-chat-reactions.sql"), "utf8");
    const listed = /check \(emoji in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const fromSql = [...listed.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql).toEqual([...CHAT_REACTIONS]);
  });

  it("adds once, removes cleanly", () => {
    let rows: ChatReactionRow[] = [];
    rows = addReaction(rows, r("m1", "a", "👍"));
    const again = addReaction(rows, r("m1", "a", "👍"));
    expect(again).toBe(rows);
    rows = addReaction(rows, r("m1", "a", "🎉"));
    expect(rows).toHaveLength(2);
    rows = removeReaction(rows, r("m1", "a", "👍"));
    expect(rows).toEqual([r("m1", "a", "🎉")]);
    expect(removeReaction(rows, r("m1", "b", "🎉"))).toBe(rows);
  });

  it("merges fetched rows without duplicates", () => {
    const held = [r("m1", "a", "👍")];
    expect(mergeReactions(held, [r("m1", "a", "👍"), r("m2", "b", "😂")])).toEqual([
      r("m1", "a", "👍"),
      r("m2", "b", "😂"),
    ]);
  });

  it("groups per message in a stable emoji order and marks the viewer's", () => {
    const summary = summarizeReactions(
      [r("m1", "b", "🎉"), r("m1", "a", "👍"), r("m1", "c", "👍"), r("m1", "a", "💩"), r("m2", "c", "❤️")],
      "a",
    );
    expect(summary.get("m1")).toEqual([
      { emoji: "👍", userIds: ["a", "c"], mine: true },
      { emoji: "🎉", userIds: ["b"], mine: false },
    ]);
    expect(summary.get("m2")).toEqual([{ emoji: "❤️", userIds: ["c"], mine: false }]);
    expect(summary.has("m3")).toBe(false);
  });
});
