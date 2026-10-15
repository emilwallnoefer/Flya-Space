"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  CHAT_PAGE_SIZE,
  fetchChatHistory,
  fetchReactionsForMessages,
  fetchVotesForMessages,
  shortNameFromEmail,
  subscribeToChat,
  type ChatMessageRow,
  type ChatPresenceUser,
  type ChatVoteRow,
  type TypingPayload,
} from "@/lib/chat";
import { addReaction, removeReaction, type ChatReactionRow } from "@/lib/chat-reactions";
import { playUiSound } from "@/lib/ui-sounds";
import { votableMessageIds } from "../types";
import { readLastReadAt, saveLastReadAt } from "./chat-last-read";

/** Everything the mount-time realtime subscription needs from the orchestrator. */
export type ChatConnectionParams = {
  openRef: MutableRefObject<boolean>;
  isAtBottomRef: MutableRefObject<boolean>;
  messagesRef: MutableRefObject<ChatMessageRow[]>;
  broadcastTypingRef: MutableRefObject<((isTyping: boolean) => Promise<void>) | null>;
  setMessages: Dispatch<SetStateAction<ChatMessageRow[]>>;
  setVotes: Dispatch<SetStateAction<ChatVoteRow[]>>;
  setReactions: Dispatch<SetStateAction<ChatReactionRow[]>>;
  setPresence: Dispatch<SetStateAction<ChatPresenceUser[]>>;
  applyTypingEvent: (payload: TypingPayload) => void;
  setUnread: Dispatch<SetStateAction<number>>;
  setPendingNew: Dispatch<SetStateAction<number>>;
  setLiveAnnouncement: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setHasMoreHistory: Dispatch<SetStateAction<boolean>>;
  setCurrentUserId: Dispatch<SetStateAction<string | null>>;
  setCurrentUserEmail: Dispatch<SetStateAction<string | null>>;
};

/**
 * Realtime subscription concern: the one mount effect that loads the initial
 * history, votes and reactions, opens the Supabase Realtime channel, routes every incoming
 * event (message insert/update/delete, vote changes, presence, typing,
 * reconnect re-sync), seeds the unread badge from the persisted last-read mark,
 * and tears everything down on unmount.
 */
export function useChatConnection(params: ChatConnectionParams) {
  const {
    openRef,
    isAtBottomRef,
    messagesRef,
    broadcastTypingRef,
    setMessages,
    setVotes,
    setReactions,
    setPresence,
    applyTypingEvent,
    setUnread,
    setPendingNew,
    setLiveAnnouncement,
    setLoading,
    setError,
    setHasMoreHistory,
    setCurrentUserId,
    setCurrentUserEmail,
  } = params;

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        const history = await fetchChatHistory();
        if (cancelled) return;
        setMessages(history);
        const initialVotes = await fetchVotesForMessages(votableMessageIds(history));
        if (cancelled) return;
        setVotes(initialVotes);
        // Before subscribing: this also learns whether the reactions table exists.
        const initialReactions = await fetchReactionsForMessages(history.map((m) => m.id));
        if (cancelled) return;
        setReactions(initialReactions);
        // If the initial page is full, assume there's more history to page in.
        setHasMoreHistory(history.length >= CHAT_PAGE_SIZE);
        setLoading(false);

        const sub = await subscribeToChat({
          onInsert: (row) => {
            let appended = false;
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              appended = true;
              return [...prev, row];
            });
            if (!appended) return;
            const isMine = row.sender_id === sub.currentUserId;
            // Track unread + pending-new + screen-reader announcements only
            // for messages from other people.
            if (!isMine) {
              if (!openRef.current) {
                setUnread((n) => n + 1);
                playUiSound("switchWhoosh");
              } else if (!isAtBottomRef.current) {
                setPendingNew((n) => n + 1);
              }
              const name = shortNameFromEmail(row.sender_email);
              const summary = row.body
                ? row.body.length > 140
                  ? `${row.body.slice(0, 140)}…`
                  : row.body
                : row.attachment_name
                  ? `sent an attachment: ${row.attachment_name}`
                  : "sent a message";
              setLiveAnnouncement(`${name}: ${summary}`);
            }
          },
          onUpdate: (row) => {
            setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
          },
          onDelete: (id) => {
            setMessages((prev) => prev.filter((m) => m.id !== id));
          },
          onVoteInsert: (row) => {
            setVotes((prev) => {
              if (prev.some((v) => v.message_id === row.message_id && v.user_id === row.user_id)) {
                return prev.map((v) =>
                  v.message_id === row.message_id && v.user_id === row.user_id ? row : v,
                );
              }
              return [...prev, row];
            });
          },
          onVoteUpdate: (row) => {
            setVotes((prev) =>
              prev.map((v) =>
                v.message_id === row.message_id && v.user_id === row.user_id ? row : v,
              ),
            );
          },
          onVoteDelete: ({ message_id, user_id }) => {
            setVotes((prev) =>
              prev.filter((v) => !(v.message_id === message_id && v.user_id === user_id)),
            );
          },
          // Reactions change the chips only: no unread, no sound, no "new" pill.
          onReactionInsert: (row) => setReactions((prev) => addReaction(prev, row)),
          onReactionDelete: (row) => setReactions((prev) => removeReaction(prev, row)),
          onPresence: (users) => setPresence(users),
          // Patch up any messages/votes that were missed during a disconnect.
          onReconnect: () => {
            void (async () => {
              try {
                // Deliberately cursor-less: the newest local row is often an
                // optimistic message stamped with the *client* clock, and
                // paging from a client timestamp that runs ahead of the server
                // silently skips everything written in the gap. Refetching the
                // latest page and de-duping by id costs one page on reconnect
                // and cannot lose messages to clock skew.
                const missed = await fetchChatHistory({ limit: CHAT_PAGE_SIZE });
                if (missed.length > 0) {
                  setMessages((prev) => {
                    const seen = new Set(prev.map((m) => m.id));
                    const additions = missed.filter((m) => !seen.has(m.id));
                    if (additions.length === 0) return prev;
                    // The refetched page is not guaranteed to be newer than
                    // everything held locally, so sort rather than append.
                    return [...prev, ...additions].sort(
                      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
                    );
                  });
                }
                // Re-sync votes for everything currently loaded (existing window
                // plus anything we just missed).
                const loadedIds = votableMessageIds([...messagesRef.current, ...missed]);
                const freshVotes = await fetchVotesForMessages(loadedIds);
                setVotes(freshVotes);
                const freshReactions = await fetchReactionsForMessages(
                  [...messagesRef.current, ...missed].map((m) => m.id),
                );
                setReactions(freshReactions);
              } catch {
                // Best-effort: a failed re-sync just leaves the state as-is.
              }
            })();
          },
          onTyping: (payload) => applyTypingEvent(payload),
        });

        if (cancelled) {
          await sub.channel.unsubscribe();
          return;
        }

        broadcastTypingRef.current = sub.broadcastTyping;
        setCurrentUserId(sub.currentUserId);
        setCurrentUserEmail(sub.currentEmail);

        // Seed the unread badge from messages that arrived while this tab was
        // closed: anything from someone else newer than the last-read mark.
        // (Realtime inserts landing after the history fetch increment `unread`
        // themselves and are not in `history`, so adding is double-count safe.)
        const lastReadAt = readLastReadAt(sub.currentUserId);
        if (lastReadAt != null) {
          const missed = history.filter(
            (m) => m.sender_id !== sub.currentUserId && Date.parse(m.created_at) > lastReadAt,
          ).length;
          if (missed > 0 && !openRef.current) setUnread((n) => n + missed);
        } else if (history.length > 0) {
          // First visit on this browser: treat existing history as read.
          saveLastReadAt(sub.currentUserId, history[history.length - 1].created_at);
        }

        await sub.trackPresence();

        unsubscribe = () => {
          void sub.channel.unsubscribe();
        };
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || "Could not connect to chat.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
