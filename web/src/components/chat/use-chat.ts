"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  CHAT_MAX_ATTACHMENT_BYTES,
  CHAT_PAGE_SIZE,
  editChatMessage,
  fetchChatHistory,
  fetchChatMembers,
  fetchVotesForMessages,
  markMessageDone,
  notifyMentions,
  sendChatMessage,
  submitCertificateRequest,
  uploadChatAttachment,
  type ChatMessageRow,
  type ChatPresenceUser,
  type MessageKind,
} from "@/lib/chat";
import type { CertificateRequestInput } from "@/lib/certificate-request";
import {
  insertMention,
  matchMembers,
  mentionTokenAtCaret,
  mentionedMemberIds,
  type ChatMember,
  type MentionToken,
} from "@/lib/chat-mentions";
import { playUiSound } from "@/lib/ui-sounds";
import { writeViewParams } from "@/lib/view-params";
import {
  ERROR_AUTO_DISMISS_MS,
  NEAR_BOTTOM_THRESHOLD_PX,
  votableMessageIds,
  type ChatWidgetProps,
  type FilterKey,
  type SendState,
} from "./types";
import { saveLastReadAt } from "./hooks/chat-last-read";
import { useChatConnection } from "./hooks/use-chat-connection";
import { useChatTyping } from "./hooks/use-chat-typing";
import { useChatUndoDelete } from "./hooks/use-chat-undo-delete";
import { useChatVotes } from "./hooks/use-chat-votes";

/** All Team Chat widget state. The realtime subscription, typing indicators,
 *  votes and undo-delete live in `./hooks/`; this orchestrator owns the message
 *  list, scroll/unread bookkeeping, composer, and the optimistic
 *  send/edit/mark-done flows, and wires the pieces together. */
export function useChat({ isAdmin = false, onClose, pillHidden = false }: ChatWidgetProps) {
  // In menu mode (`onClose` given) the widget is mounted by a click, so it
  // starts open; the floating-pill mode starts closed — unless the page was
  // opened from a mention notification (`/dashboard?chat=open`). The widget
  // renders client-side only, so reading the URL here is safe.
  const [open, setOpen] = useState(
    () => onClose != null || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("chat") === "open"),
  );
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [presence, setPresence] = useState<ChatPresenceUser[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingKind, setPendingKind] = useState<MessageKind>("message");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Pagination
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Scroll bookkeeping for "stay where I am" + jump-to-bottom pill
  const [pendingNew, setPendingNew] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Live announcement string for screen readers (last incoming message).
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  // Lightbox state for attachment image previews.
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  // Presence overflow popover open/closed.
  const [presenceOpen, setPresenceOpen] = useState(false);
  // Certificate-request form: a modal rather than a composer mode, because the
  // request is a set of fields and is submitted through its own API route.
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [certificateSending, setCertificateSending] = useState(false);
  const [certificateSent, setCertificateSent] = useState(false);
  // @-mentions: the team list (loaded once the panel first opens), the token
  // under the caret, and which candidate the arrow keys point at.
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [mentionToken, setMentionToken] = useState<MentionToken | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // The message the next send answers (the "Replying to" strip).
  const [replyTarget, setReplyTarget] = useState<ChatMessageRow | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The list's inner wrapper; watched for size changes so the view stays on the
  // latest message while images and attachments finish laying out.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  // Refs to keep handlers stable while reflecting latest values.
  const isAtBottomRef = useRef(true);
  isAtBottomRef.current = isAtBottom;
  const messagesRef = useRef<ChatMessageRow[]>([]);
  messagesRef.current = messages;

  // Stable error sink shared with the extracted hooks.
  const reportError = useCallback((message: string) => setError(message), []);

  const {
    broadcastTypingRef,
    applyTypingEvent,
    broadcastDraftTyping,
    resetTyping,
    otherTypingNames,
  } = useChatTyping(currentUserId);
  const { setVotes, voteSummary, handleVote } = useChatVotes(currentUserId, reportError);
  const { pendingUndo, handleDelete, handleUndoDelete } = useChatUndoDelete(setMessages, reportError);

  useChatConnection({
    openRef,
    isAtBottomRef,
    messagesRef,
    broadcastTypingRef,
    setMessages,
    setVotes,
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
  });

  // Whenever the panel opens, jump to the latest message and clear unread.
  // Opening always lands on the newest message, wherever the reader was last
  // time, so "at bottom" is asserted here rather than left to the scroll
  // handler (which only fires once something scrolls).
  useEffect(() => {
    if (!open) return;
    setUnread(0);
    setPendingNew(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    // Now (the list is already in the DOM when the history was loaded before
    // opening), and again on the next frame for anything laid out after.
    const jump = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    jump();
    requestAnimationFrame(jump);
  }, [open]);

  // One scrollTop assignment on open is not enough: the history lands a moment
  // later, images decode after that, and each one grows the list under the
  // viewport. While the reader is at the bottom, follow every content resize
  // so the latest message stays in view; once they scroll up, leave them be.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [open]);

  // The team list for @-mentions: one request per widget mount, the first
  // time the panel is open. A failure only means no picker.
  const membersLoadedRef = useRef(false);
  useEffect(() => {
    if (!open || membersLoadedRef.current) return;
    membersLoadedRef.current = true;
    let cancelled = false;
    fetchChatMembers()
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        membersLoadedRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Opened from a notification: the `chat=open` param has done its job.
  useEffect(() => {
    if (open) writeViewParams({ chat: null });
  }, [open]);

  // While the panel is open, keep the persistent last-read mark at the newest
  // loaded message so a reload doesn't resurrect the badge for messages the
  // user just saw.
  useEffect(() => {
    if (!open || !currentUserId) return;
    const latest = messages[messages.length - 1];
    if (latest) saveLastReadAt(currentUserId, latest.created_at);
  }, [open, currentUserId, messages]);

  // Re-scroll only when the user is already at/near the bottom (or when they
  // change the filter, which is an explicit context switch). This prevents
  // new messages from yanking the viewport away while reading older ones.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages.length, open]);

  // Filter change is an explicit user action — always snap to bottom.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    setPendingNew(0);
  }, [filter, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else if (certificateOpen) {
          // Don't discard a half-filled form mid-submit.
          if (!certificateSending) setCertificateOpen(false);
        } else if (editingId) setEditingId(null);
        else if (mentionToken) setMentionToken(null);
        else if (replyTarget) setReplyTarget(null);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editingId, lightbox, certificateOpen, certificateSending, mentionToken, replyTarget]);

  // Auto-dismiss errors after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  // Track scroll position so the insert handler / pill know whether the
  // user is currently at the bottom.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < NEAR_BOTTOM_THRESHOLD_PX;
    setIsAtBottom(near);
    if (near) setPendingNew(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPendingNew(0);
  }, []);

  const handleLoadOlder = useCallback(async () => {
    if (loadingMore || !hasMoreHistory) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    const el = scrollRef.current;
    const previousScrollHeight = el?.scrollHeight ?? 0;
    setLoadingMore(true);
    try {
      const older = await fetchChatHistory({ before: oldest.created_at, limit: CHAT_PAGE_SIZE });
      if (older.length === 0) {
        setHasMoreHistory(false);
        return;
      }
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const additions = older.filter((m) => !seen.has(m.id));
        return [...additions, ...prev];
      });
      // Pull in votes for the older page so its tallies render correctly.
      const olderVotes = await fetchVotesForMessages(votableMessageIds(older));
      if (olderVotes.length > 0) {
        setVotes((prev) => {
          const seen = new Set(prev.map((v) => `${v.message_id}:${v.user_id}`));
          const additions = olderVotes.filter((v) => !seen.has(`${v.message_id}:${v.user_id}`));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
      }
      setHasMoreHistory(older.length >= CHAT_PAGE_SIZE);
      // Preserve visible position by adjusting scrollTop for the height delta.
      requestAnimationFrame(() => {
        const after = scrollRef.current;
        if (!after) return;
        after.scrollTop = after.scrollHeight - previousScrollHeight;
      });
    } catch (err) {
      setError((err as Error).message || "Could not load older messages.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreHistory, setVotes]);

  const visibleMessages = useMemo(() => {
    if (filter === "all") return messages;
    return messages.filter((m) => m.kind === filter && !m.done_at);
  }, [messages, filter]);

  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      all: messages.length,
      feature_request: 0,
      certificate_request: 0,
      best_practice: 0,
    };
    for (const m of messages) {
      if (m.kind === "message" || m.done_at) continue;
      if (m.kind === "feature_request") counts.feature_request += 1;
      else if (m.kind === "certificate_request") counts.certificate_request += 1;
      else if (m.kind === "best_practice") counts.best_practice += 1;
      // `change_request` is retired and has no tab — legacy rows count under "All" only.
    }
    return counts;
  }, [messages]);

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setDraft(value);
      broadcastDraftTyping(value);
      const token = mentionTokenAtCaret(value, event.target.selectionStart ?? value.length);
      setMentionToken((prev) => {
        if (!token) return null;
        // A fresh token starts the list at the top; the same one keeps the row.
        if (!prev || prev.start !== token.start) setMentionIndex(0);
        return token;
      });
    },
    [broadcastDraftTyping],
  );

  /** People matching the token under the caret, never the writer themselves. */
  const mentionCandidates = useMemo(() => {
    if (!mentionToken || members.length === 0) return [];
    return matchMembers(
      members.filter((member) => member.id !== currentUserId),
      mentionToken.query,
    );
  }, [mentionToken, members, currentUserId]);

  // Keep the highlighted row inside the list as it shrinks.
  useEffect(() => {
    if (mentionIndex >= mentionCandidates.length) setMentionIndex(0);
  }, [mentionCandidates.length, mentionIndex]);

  const pickMention = useCallback(
    (member: ChatMember) => {
      if (!mentionToken) return;
      const next = insertMention(draft, mentionToken, member);
      setDraft(next.draft);
      setMentionToken(null);
      broadcastDraftTyping(next.draft);
      // The caret goes after the inserted name once React has written the value.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    },
    [draft, mentionToken, broadcastDraftTyping],
  );

  /** Tell the people a saved message mentions. The sender never notifies themselves. */
  const notifyMentionedPeople = useCallback(
    (saved: ChatMessageRow) => {
      const ids = mentionedMemberIds(saved.body, members).filter((id) => id !== saved.sender_id);
      if (ids.length > 0) void notifyMentions(saved.id, ids);
    },
    [members],
  );

  const startReply = useCallback((message: ChatMessageRow) => {
    setReplyTarget(message);
    setEditingId(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  /** Scroll a loaded message into view and light it up once (a reply's quote was tapped). */
  const jumpToMessage = useCallback((messageId: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const row = root.querySelector<HTMLElement>(`[data-chat-message-id="${messageId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("chat-msg-flash");
    // Restart the one-shot animation even when the same quote is tapped twice.
    void row.offsetWidth;
    row.classList.add("chat-msg-flash");
    window.setTimeout(() => row.classList.remove("chat-msg-flash"), 1300);
  }, []);

  /*
   * All mutating actions below follow the same pattern: update local state
   * *synchronously* so the UI responds instantly, then fire the network
   * request in the background. If the server rejects, we revert the local
   * change and surface an error. Optimistic rows use client-generated UUIDs
   * that match the server-side id, so when the Realtime echo arrives we
   * silently dedupe instead of flashing a duplicate.
   */
  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!currentUserId) return;

    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const kindAtSend = pendingKind;
    const replyToAtSend = replyTarget?.id ?? null;
    const optimistic: ChatMessageRow = {
      id,
      sender_id: currentUserId,
      sender_email: currentUserEmail ?? "unknown",
      body: trimmed,
      attachment_path: null,
      attachment_name: null,
      attachment_type: null,
      attachment_size: null,
      kind: kindAtSend,
      created_at: new Date().toISOString(),
      edited_at: null,
      done_at: null,
      done_by: null,
      reply_to: replyToAtSend,
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setPendingKind("message");
    setReplyTarget(null);
    setMentionToken(null);
    setError(null);
    resetTyping();
    playUiSound("mailSend");

    void (async () => {
      try {
        const saved = await sendChatMessage({ id, body: trimmed, kind: kindAtSend, replyTo: replyToAtSend });
        setMessages((prev) => prev.map((m) => (m.id === id ? saved : m)));
        notifyMentionedPeople(saved);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        setDraft((current) => (current === "" ? trimmed : current));
        setPendingKind(kindAtSend);
        if (replyToAtSend) setReplyTarget((current) => current ?? replyTarget);
        setError((err as Error).message || "Failed to send.");
      }
    })();
  }, [draft, pendingKind, replyTarget, currentUserId, currentUserEmail, resetTyping, notifyMentionedPeople]);

  /*
   * Certificate requests are the one flow that is NOT optimistic. The server
   * renders the summary body and mails the admins, so there is nothing
   * meaningful to show until it answers — and a row that appeared locally and
   * then vanished on a mail/DB failure would leave the sender unsure whether
   * the admins were told. The modal keeps its spinner until the row comes back.
   */
  const handleCertificateSubmit = useCallback((input: CertificateRequestInput) => {
    setCertificateSending(true);
    setError(null);
    void (async () => {
      try {
        const saved = await submitCertificateRequest(input);
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
        setCertificateOpen(false);
        setCertificateSent(true);
        playUiSound("mailSend");
      } catch (err) {
        setError((err as Error).message || "Could not send the certificate request.");
      } finally {
        setCertificateSending(false);
      }
    })();
  }, []);

  // Clear the "sent" confirmation after it has been read.
  useEffect(() => {
    if (!certificateSent) return;
    const t = window.setTimeout(() => setCertificateSent(false), 5000);
    return () => window.clearTimeout(t);
  }, [certificateSent]);

  const uploadAndSendAttachment = useCallback(
    async (file: File) => {
      if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
        setError(`File too large. Max ${Math.round(CHAT_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`);
        return;
      }
      // The upload itself is slow (network + storage), so we keep a spinner
      // on the composer for attachments. The DB insert still runs in the
      // background once the upload completes so the message appears the
      // instant the upload finishes.
      setSendState("sending");
      setError(null);
      const bodyAtPick = draft.trim() || undefined;
      const kindAtPick = pendingKind;
      const replyToAtPick = replyTarget?.id ?? null;
      try {
        const uploaded = await uploadChatAttachment(file);
        const id = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimistic: ChatMessageRow = {
          id,
          sender_id: currentUserId ?? "",
          sender_email: currentUserEmail ?? "unknown",
          body: bodyAtPick ?? null,
          attachment_path: uploaded.path,
          attachment_name: uploaded.name,
          attachment_type: uploaded.type,
          attachment_size: uploaded.size,
          kind: kindAtPick,
          created_at: new Date().toISOString(),
          edited_at: null,
          done_at: null,
          done_by: null,
          reply_to: replyToAtPick,
        };
        setMessages((prev) => [...prev, optimistic]);
        setDraft("");
        setPendingKind("message");
        setReplyTarget(null);
        setMentionToken(null);
        playUiSound("mailSend");
        setSendState("idle");
        void (async () => {
          try {
            const saved = await sendChatMessage({
              id,
              body: bodyAtPick,
              kind: kindAtPick,
              attachment: uploaded,
              replyTo: replyToAtPick,
            });
            setMessages((prev) => prev.map((m) => (m.id === id ? saved : m)));
            notifyMentionedPeople(saved);
          } catch (err) {
            setMessages((prev) => prev.filter((m) => m.id !== id));
            setError((err as Error).message || "Failed to send.");
          }
        })();
      } catch (err) {
        setError((err as Error).message || "Upload failed.");
        setSendState("idle");
      }
    },
    [draft, pendingKind, replyTarget, currentUserId, currentUserEmail, notifyMentionedPeople],
  );

  const handleAttachmentPick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      await uploadAndSendAttachment(file);
    },
    [uploadAndSendAttachment],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // While the mention picker is up, the keyboard drives it.
      if (mentionCandidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % mentionCandidates.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          pickMention(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)]);
          return;
        }
        // Escape is handled by the window listener (closes the picker first).
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionCandidates, mentionIndex, pickMention],
  );

  // The caret can move without the text changing (arrow keys, a tap); the
  // picker follows it so it never sits open over a token the caret has left.
  const handleCaretMove = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const token = mentionTokenAtCaret(el.value, el.selectionStart ?? el.value.length);
    setMentionToken((prev) => {
      if (!token) return prev ? null : prev;
      if (prev && prev.start === token.start && prev.end === token.end) return prev;
      return token;
    });
  }, []);

  const handleMarkDone = useCallback(
    (messageId: string, done: boolean) => {
      const timestamp = done ? new Date().toISOString() : null;
      const doneBy = done ? currentUserId : null;
      let previous: ChatMessageRow | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          previous = m;
          return { ...m, done_at: timestamp, done_by: doneBy };
        }),
      );
      void (async () => {
        try {
          const updated = await markMessageDone(messageId, done);
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        } catch (err) {
          if (previous) {
            const restored = previous;
            setMessages((prev) => prev.map((m) => (m.id === messageId ? restored : m)));
          }
          setError((err as Error).message || "Could not update.");
        }
      })();
    },
    [currentUserId],
  );

  const handleSaveEdit = useCallback((messageId: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const timestamp = new Date().toISOString();
    let previous: ChatMessageRow | undefined;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        previous = m;
        return { ...m, body: trimmed, edited_at: timestamp };
      }),
    );
    setEditingId(null);
    void (async () => {
      try {
        const updated = await editChatMessage(messageId, trimmed);
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      } catch (err) {
        if (previous) {
          const restored = previous;
          setMessages((prev) => prev.map((m) => (m.id === messageId ? restored : m)));
        }
        setError((err as Error).message || "Could not edit.");
      }
    })();
  }, []);

  /*
   * Paste-to-upload: when the user pastes an image into the textarea, treat
   * it as an attachment send. Falls through to default paste behavior if no
   * image is present in the clipboard.
   */
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          event.preventDefault();
          void uploadAndSendAttachment(file);
          return;
        }
      }
    },
    [uploadAndSendAttachment],
  );

  const onlineCount = presence.length;

  /** Loaded messages by id, so a reply can show the message it answers. */
  const messagesById = useMemo(() => {
    const map = new Map<string, ChatMessageRow>();
    for (const message of messages) map.set(message.id, message);
    return map;
  }, [messages]);

  return {
    // props echoed for the orchestrator
    isAdmin,
    pillHidden,
    // panel + connection state
    open,
    setOpen,
    loading,
    error,
    setError,
    unread,
    liveAnnouncement,
    currentUserId,
    presence,
    onlineCount,
    presenceOpen,
    setPresenceOpen,
    otherTypingNames,
    // messages + pagination
    visibleMessages,
    messagesById,
    voteSummary,
    hasMoreHistory,
    loadingMore,
    handleLoadOlder,
    // scroll bookkeeping
    scrollRef,
    contentRef,
    handleScroll,
    scrollToBottom,
    isAtBottom,
    pendingNew,
    // composer
    draft,
    textareaRef,
    handleDraftChange,
    handleKeyDown,
    handleCaretMove,
    handlePaste,
    // @-mentions
    members,
    mentionCandidates,
    mentionIndex,
    setMentionIndex,
    pickMention,
    // replies
    replyTarget,
    setReplyTarget,
    startReply,
    jumpToMessage,
    pendingKind,
    setPendingKind,
    sendState,
    fileInputRef,
    handleSend,
    handleAttachmentPick,
    // certificate request modal
    currentUserEmail,
    certificateOpen,
    setCertificateOpen,
    certificateSending,
    certificateSent,
    handleCertificateSubmit,
    // filter
    filter,
    setFilter,
    filterCounts,
    // per-message actions
    editingId,
    setEditingId,
    handleSaveEdit,
    handleDelete,
    handleVote,
    handleMarkDone,
    // undo + lightbox
    pendingUndo,
    handleUndoDelete,
    lightbox,
    setLightbox,
  };
}

export type ChatState = ReturnType<typeof useChat>;
