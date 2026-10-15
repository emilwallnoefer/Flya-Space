"use client";

import { useCallback, useMemo, useState } from "react";
import { setMessageReaction } from "@/lib/chat";
import {
  addReaction,
  removeReaction,
  summarizeReactions,
  type ChatReactionRow,
} from "@/lib/chat-reactions";

/**
 * Emoji reactions: the loaded rows, the per-message summary, and the
 * optimistic toggle. Realtime echoes and fetches land through `setReactions`
 * from the connection and pagination code. Nothing here touches unread counts
 * or sounds — a reaction is not a new message.
 */
export function useChatReactions(currentUserId: string | null, onError: (message: string) => void) {
  const [reactions, setReactions] = useState<ChatReactionRow[]>([]);

  const reactionSummary = useMemo(() => summarizeReactions(reactions, currentUserId), [reactions, currentUserId]);

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      if (!currentUserId) return;
      const row: ChatReactionRow = { message_id: messageId, user_id: currentUserId, emoji };
      const on = !reactions.some(
        (r) => r.message_id === messageId && r.user_id === currentUserId && r.emoji === emoji,
      );
      setReactions((prev) => (on ? addReaction(prev, row) : removeReaction(prev, row)));
      void (async () => {
        try {
          await setMessageReaction(messageId, emoji, on);
        } catch (err) {
          // Undo just this toggle; anything else that arrived meanwhile stays.
          setReactions((prev) => (on ? removeReaction(prev, row) : addReaction(prev, row)));
          onError((err as Error).message || "Reaction failed.");
        }
      })();
    },
    [currentUserId, reactions, onError],
  );

  return { setReactions, reactionSummary, handleReact };
}
