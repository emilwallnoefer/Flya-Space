// @vitest-environment jsdom
/**
 * Regression test for messages lost after a realtime reconnect.
 *
 * The re-sync used to page from `last.created_at`, but the last local row is
 * often an *optimistic* message stamped with the client's clock. When that
 * clock runs ahead of the server, `after: <future timestamp>` silently skipped
 * every message written in the gap — they never appeared until a reload, which
 * reads as "my message didn't save".
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageRow } from "@/lib/chat";

const historyCalls: Array<{ after?: string; before?: string } | undefined> = [];
let serverHistory: ChatMessageRow[] = [];
let triggerReconnect: (() => void) | null = null;

function msg(id: string, createdAt: string, sender = "other"): ChatMessageRow {
  return {
    id,
    sender_id: sender,
    sender_email: `${sender}@flyability.com`,
    body: id,
    attachment_path: null,
    attachment_name: null,
    attachment_type: null,
    attachment_size: null,
    kind: "message",
    created_at: createdAt,
    edited_at: null,
    done_at: null,
    done_by: null,
  } as ChatMessageRow;
}

vi.mock("@/lib/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat")>();
  return {
    ...actual,
    fetchChatHistory: vi.fn(async (opts?: { after?: string; before?: string; limit?: number }) => {
      historyCalls.push(opts);
      if (opts?.after) {
        return serverHistory.filter((m) => Date.parse(m.created_at) > Date.parse(opts.after!));
      }
      return serverHistory;
    }),
    fetchVotesForMessages: vi.fn(async () => []),
    fetchReactionsForMessages: vi.fn(async () => []),
    subscribeToChat: vi.fn(async (handlers: { onReconnect: () => void }) => {
      triggerReconnect = handlers.onReconnect;
      return {
        channel: { unsubscribe: async () => {} },
        currentUserId: "me",
        currentEmail: "me@flyability.com",
        broadcastTyping: async () => {},
        trackPresence: async () => {},
      };
    }),
  };
});

vi.mock("@/lib/ui-sounds", () => ({ playUiSound: () => {}, stopUiSound: () => {} }));

import { useChatConnection } from "./use-chat-connection";

describe("chat reconnect re-sync", () => {
  beforeEach(() => {
    historyCalls.length = 0;
    triggerReconnect = null;
    serverHistory = [];
  });

  it("does not skip server messages when the newest local row is optimistic", async () => {
    // At mount the server only has an older message.
    const older = msg("older", new Date(Date.now() - 60_000).toISOString());
    serverHistory = [older];

    const messagesRef = { current: [] as ChatMessageRow[] };

    const captured: ChatMessageRow[][] = [];
    const setMessages = ((updater: unknown) => {
      const next =
        typeof updater === "function"
          ? (updater as (p: ChatMessageRow[]) => ChatMessageRow[])(messagesRef.current)
          : (updater as ChatMessageRow[]);
      messagesRef.current = next;
      captured.push(next);
    }) as never;

    const noop = (() => {}) as never;
    renderHook(() =>
      useChatConnection({
        openRef: { current: false },
        isAtBottomRef: { current: true },
        messagesRef,
        broadcastTypingRef: { current: null },
        setMessages,
        setVotes: noop,
        setReactions: noop,
        setPresence: noop,
        applyTypingEvent: () => {},
        setUnread: noop,
        setPendingNew: noop,
        setLiveAnnouncement: noop,
        setLoading: noop,
        setError: noop,
        setHasMoreHistory: noop,
        setCurrentUserId: noop,
        setCurrentUserEmail: noop,
      }),
    );

    await waitFor(() => expect(triggerReconnect).not.toBeNull());
    await waitFor(() => expect(messagesRef.current.some((m) => m.id === "older")).toBe(true));

    // The user sends a message: an optimistic row stamped with the *client*
    // clock, here running 60s ahead of the server.
    const optimistic = msg("optimistic", new Date(Date.now() + 60_000).toISOString(), "me");
    messagesRef.current = [...messagesRef.current, optimistic];

    // While disconnected, someone else's message lands on the server "now" —
    // earlier than the optimistic row's future stamp.
    const missedMsg = msg("missed-while-offline", new Date(Date.now()).toISOString());
    serverHistory = [...serverHistory, missedMsg];

    historyCalls.length = 0;
    triggerReconnect!();

    // It must be picked up; paging from the optimistic row's future timestamp
    // would skip it forever.
    await waitFor(() => {
      expect(messagesRef.current.some((m) => m.id === "missed-while-offline")).toBe(true);
    });
  });
});
