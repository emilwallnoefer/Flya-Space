"use client";

import { useEffect, useState } from "react";
import { readLastReadAt } from "./chat-last-read";

/**
 * The number of messages from other people since this browser last had the
 * chat open, for a badge on a surface that does not mount the chat (the
 * phone's Chat tab). One small request to /api/chat/unread on mount, whenever
 * the page becomes visible again, and whenever `paused` goes back to false —
 * the caller passes `paused` while the chat screen is open, since that screen
 * keeps the last-read mark itself and the count is meaningless meanwhile. No
 * realtime: the phone is a glance-and-go surface, and a count that is right
 * each time the person looks is what the badge needs.
 */
export function useChatUnreadCount(paused: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/chat/unread", { credentials: "same-origin" });
        if (!response.ok) return;
        const payload = (await response.json()) as { user_id: string; recent: Array<{ created_at: string; mine: boolean }> };
        if (cancelled) return;
        const lastReadAt = readLastReadAt(payload.user_id);
        // First visit on this browser: nothing is "new" yet; opening the chat
        // sets the mark.
        if (lastReadAt == null) {
          setCount(0);
          return;
        }
        setCount(payload.recent.filter((m) => !m.mine && Date.parse(m.created_at) > lastReadAt).length);
      } catch {
        // Offline or signed out: keep whatever we showed.
      }
    };
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [paused]);

  // While the chat is open there is nothing unread; the next unpause refetches.
  return paused ? 0 : count;
}
