import { describe, expect, it } from "vitest";
import { CHAT_EDIT_WINDOW_MS, canEditChatMessage, chatEditTimeLeft } from "./chat-edit-window";

const sent = "2026-10-14T12:00:00.000Z";
const at = (offsetMs: number) => Date.parse(sent) + offsetMs;

describe("chat edit window", () => {
  it("is open for 10 minutes after sending", () => {
    expect(CHAT_EDIT_WINDOW_MS).toBe(600_000);
    expect(canEditChatMessage(sent, at(0))).toBe(true);
    expect(canEditChatMessage(sent, at(9 * 60_000 + 59_000))).toBe(true);
  });
  it("closes at exactly 10 minutes", () => {
    expect(canEditChatMessage(sent, at(CHAT_EDIT_WINDOW_MS))).toBe(false);
    expect(canEditChatMessage(sent, at(60 * 60_000))).toBe(false);
  });
  it("reports the time left, never negative", () => {
    expect(chatEditTimeLeft(sent, at(4 * 60_000))).toBe(6 * 60_000);
    expect(chatEditTimeLeft(sent, at(20 * 60_000))).toBe(0);
  });
  it("treats an unparseable timestamp as closed", () => {
    expect(canEditChatMessage("not a date", at(0))).toBe(false);
  });
});
