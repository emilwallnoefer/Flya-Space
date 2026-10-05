"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { CertificateRequestInput } from "@/lib/certificate-request";

/**
 * Team Chat client helpers.
 *
 * Schema lives in:
 *   - web/supabase/2026-04-19-team-chat.sql            (base)
 *   - web/supabase/2026-04-19-team-chat-marks-and-votes.sql (kinds + votes)
 *
 * One global channel, one `chat_messages` table, RLS that lets every authed
 * user read every message and only the author can insert/edit/delete.
 * Marking a feature/change request as "done" goes through the admin-only
 * `/api/chat/mark-done` route (service-role bypass of RLS).
 *
 * Realtime delivers INSERT/UPDATE/DELETE events on `chat_messages` and
 * `chat_message_votes`; presence and typing indicators are ephemeral over
 * Supabase Realtime channels (no DB writes).
 */

export const CHAT_BUCKET = "chat-attachments";
export const CHAT_REALTIME_TOPIC = "team-chat:global";
/** Initial page size when opening the chat. Older messages can be paged in
 *  via `fetchChatHistory({ before })`. */
export const CHAT_HISTORY_LIMIT = 50;
/** Page size when the user clicks "Load older". */
export const CHAT_PAGE_SIZE = 50;

/** Max upload size for chat attachments (10 MiB). Checked client-side for a
 *  friendly error; the bucket enforces the same limit server-side
 *  (`2026-07-04-tier1-hardening.sql`). */
export const CHAT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * `change_request` is **legacy**: the composer slot it used to occupy is now
 * "Certificate", and no new row can be created with that kind. It stays in the
 * union (and in the DB check constraint) so the change requests already in the
 * history keep rendering their badge instead of silently losing it.
 */
export type MessageKind =
  | "message"
  | "feature_request"
  | "change_request"
  | "best_practice"
  | "certificate_request";
export const MESSAGE_KINDS: MessageKind[] = [
  "message",
  "feature_request",
  "change_request",
  "best_practice",
  "certificate_request",
];
export type TaggedMessageKind = Exclude<MessageKind, "message">;
/** Every non-plain kind, including the retired `change_request`. */
export const TAGGED_KINDS: TaggedMessageKind[] = [
  "feature_request",
  "change_request",
  "best_practice",
  "certificate_request",
];
/** The kinds the composer can still produce — drives the mode picker and the
 *  filter strip. Order is the order they appear in the UI. */
export const COMPOSABLE_KINDS: TaggedMessageKind[] = [
  "feature_request",
  "certificate_request",
  "best_practice",
];
export const VOTABLE_KINDS: TaggedMessageKind[] = ["feature_request", "change_request"];
/** Admins can also resolve a certificate request once the certificates are
 *  issued, which drops it out of the "Certificate" filter. */
export const MARKABLE_KINDS: TaggedMessageKind[] = [
  "feature_request",
  "change_request",
  "certificate_request",
];

export function isVotableKind(kind: MessageKind): boolean {
  return (VOTABLE_KINDS as readonly MessageKind[]).includes(kind);
}
export function isMarkableKind(kind: MessageKind): boolean {
  return (MARKABLE_KINDS as readonly MessageKind[]).includes(kind);
}

export function messageKindLabel(kind: MessageKind): string {
  switch (kind) {
    case "feature_request":
      return "Feature request";
    case "change_request":
      return "Change request";
    case "best_practice":
      return "Best practice";
    case "certificate_request":
      return "Certificate request";
    default:
      return "Message";
  }
}

export type ChatMessageRow = {
  id: string;
  sender_id: string;
  sender_email: string;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  created_at: string;
  kind: MessageKind;
  done_at: string | null;
  done_by: string | null;
  edited_at: string | null;
};

export type ChatVoteRow = {
  message_id: string;
  user_id: string;
  vote: -1 | 1;
};

export type VoteSummary = {
  up: number;
  down: number;
  /** Current viewer's vote (0 = none). */
  mine: -1 | 0 | 1;
};

export type ChatPresenceUser = {
  user_id: string;
  email: string;
  online_at: string;
};

export type TypingPayload = {
  user_id: string;
  email: string;
  is_typing: boolean;
};

const MESSAGE_COLUMNS =
  "id, sender_id, sender_email, body, attachment_path, attachment_name, attachment_type, attachment_size, created_at, kind, done_at, done_by, edited_at";

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!_client) _client = createClient();
  return _client;
}

export type FetchHistoryOptions = {
  /** ISO timestamp; only return messages strictly older than this. */
  before?: string;
  /** ISO timestamp; only return messages strictly newer than this (used to
   *  patch up gaps after a Realtime reconnection). */
  after?: string;
  /** Defaults to CHAT_PAGE_SIZE. */
  limit?: number;
};

/**
 * Fetch a slice of chat history. By default returns the most recent
 * `CHAT_HISTORY_LIMIT` messages, oldest -> newest. Pass `before` to load an
 * older page, or `after` to fill in a gap (e.g. after a reconnect).
 */
export async function fetchChatHistory(opts: FetchHistoryOptions = {}): Promise<ChatMessageRow[]> {
  const supabase = client();
  const limit = opts.limit ?? (opts.before || opts.after ? CHAT_PAGE_SIZE : CHAT_HISTORY_LIMIT);

  let q = supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.before) q = q.lt("created_at", opts.before);
  if (opts.after) q = q.gt("created_at", opts.after);

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as ChatMessageRow[]).slice().reverse();
}

/**
 * Fetch votes for a specific set of messages. Scoped to the message ids the
 * widget currently has loaded so we never read the entire chat_message_votes
 * table (which grows unbounded with every vote ever cast). Ids are chunked to
 * stay under PostgREST's URL-length limit on the `in` filter.
 */
export async function fetchVotesForMessages(messageIds: string[]): Promise<ChatVoteRow[]> {
  if (messageIds.length === 0) return [];
  const supabase = client();
  const CHUNK = 200;
  const out: ChatVoteRow[] = [];
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const chunk = messageIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("chat_message_votes")
      .select("message_id, user_id, vote")
      .in("message_id", chunk);
    if (error) throw error;
    out.push(...((data ?? []) as ChatVoteRow[]));
  }
  return out;
}

type SendInput = {
  /**
   * Optional client-generated UUID. When provided, it is used as the row's
   * primary key — this lets callers render an optimistic message locally and
   * have the persisted row arrive via Realtime (or the insert response) with
   * the same id, so the optimistic entry is silently replaced instead of
   * duplicated.
   */
  id?: string;
  body?: string;
  kind?: MessageKind;
  attachment?: {
    path: string;
    name: string;
    type: string;
    size: number;
  };
};

export async function sendChatMessage(input: SendInput): Promise<ChatMessageRow> {
  const supabase = client();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const user = userData.user;

  const trimmed = (input.body ?? "").trim();
  if (!trimmed && !input.attachment) {
    throw new Error("Message must have text or an attachment.");
  }

  const insertRow = {
    ...(input.id ? { id: input.id } : {}),
    sender_id: user.id,
    sender_email: user.email ?? "unknown",
    body: trimmed || null,
    attachment_path: input.attachment?.path ?? null,
    attachment_name: input.attachment?.name ?? null,
    attachment_type: input.attachment?.type ?? null,
    attachment_size: input.attachment?.size ?? null,
    kind: input.kind ?? "message",
  };

  const { data, error } = await supabase
    .from("chat_messages")
    .insert(insertRow)
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ChatMessageRow;
}

export async function editChatMessage(messageId: string, body: string): Promise<ChatMessageRow> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Edited message cannot be empty.");
  const supabase = client();
  const { data, error } = await supabase
    .from("chat_messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ChatMessageRow;
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.from("chat_messages").delete().eq("id", messageId);
  if (error) throw error;
}

/**
 * Set or clear the current viewer's vote on a message. Pass `0` to remove.
 * Uses upsert so re-voting in the same direction is a no-op.
 */
export async function setMessageVote(
  messageId: string,
  vote: -1 | 0 | 1,
): Promise<void> {
  const supabase = client();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const user = userData.user;

  if (vote === 0) {
    const { error } = await supabase
      .from("chat_message_votes")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", user.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("chat_message_votes")
    .upsert(
      {
        message_id: messageId,
        user_id: user.id,
        vote,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id,user_id" },
    );
  if (error) throw error;
}

export async function markMessageDone(messageId: string, done: boolean): Promise<ChatMessageRow> {
  const response = await fetch("/api/chat/mark-done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id: messageId, done }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | { ok: true; message: ChatMessageRow }
    | { error: string };
  if (!response.ok || !("ok" in payload)) {
    throw new Error(("error" in payload && payload.error) || "Failed to mark message");
  }
  return payload.message;
}

/**
 * Submit a certificate request. Unlike a normal message this does not insert
 * from the browser: the route stamps the trainer from the session, formats the
 * summary, writes the `certificate_request` row and mails the admins, so the
 * chat body and the notification can never disagree. The saved row comes back
 * so the sender sees it immediately instead of waiting for the Realtime echo.
 */
export async function submitCertificateRequest(
  input: CertificateRequestInput,
): Promise<ChatMessageRow> {
  const response = await fetch("/api/chat/certificate-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | { ok: true; message: ChatMessageRow; notified: boolean }
    | { error: string };
  if (!response.ok || !("ok" in payload)) {
    throw new Error(
      ("error" in payload && payload.error) || "Failed to send the certificate request.",
    );
  }
  return payload.message;
}

/**
 * Upload an attachment to the chat bucket. Returns the storage path that can
 * be persisted on a `chat_messages` row. The path is forced to be under the
 * caller's user folder to match the bucket's RLS policy.
 */
export async function uploadChatAttachment(file: File): Promise<{
  path: string;
  name: string;
  type: string;
  size: number;
}> {
  if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File is too large. Max is ${Math.round(CHAT_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
    );
  }
  const supabase = client();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const user = userData.user;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
  const id = (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)) as string;
  const path = `${user.id}/${Date.now()}-${id}-${safeName}`;

  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return { path, name: file.name, type: file.type || "application/octet-stream", size: file.size };
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const _signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function getAttachmentSignedUrl(path: string, downloadName?: string | null): Promise<string> {
  const cacheKey = `${path}\n${downloadName ?? ""}`;
  const cached = _signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  const supabase = client();
  // `download` makes Storage serve `Content-Disposition: attachment`, so a file
  // opened from its link is saved, never rendered on the Supabase origin. The
  // Content-Type is whatever the uploader claimed, and some allowed types
  // (XML) run script when rendered (audit run-5). <img> still displays an
  // attachment-disposition image, so inline previews are unaffected.
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: downloadName || true });
  if (error || !data?.signedUrl) throw error ?? new Error("Failed to sign URL");
  _signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

export type ChatChannelHandlers = {
  onInsert: (row: ChatMessageRow) => void;
  onUpdate: (row: ChatMessageRow) => void;
  onDelete: (rowId: string) => void;
  onVoteInsert: (row: ChatVoteRow) => void;
  onVoteUpdate: (row: ChatVoteRow) => void;
  onVoteDelete: (row: { message_id: string; user_id: string }) => void;
  onPresence: (users: ChatPresenceUser[]) => void;
  onTyping: (payload: TypingPayload) => void;
  /** Fires every time the channel transitions back to SUBSCRIBED *after* the
   *  initial subscription, i.e. a reconnection — caller should refetch any
   *  data that may have been missed while disconnected. */
  onReconnect?: () => void;
};

/**
 * Subscribes to:
 *   - Postgres INSERT/UPDATE/DELETE on `public.chat_messages`
 *   - Postgres INSERT/UPDATE/DELETE on `public.chat_message_votes`
 *   - Realtime presence on `CHAT_REALTIME_TOPIC` (online users)
 *   - Broadcast events on `typing` (typing indicators)
 *
 * Returns the channel — call `.unsubscribe()` on it when unmounting.
 */
export async function subscribeToChat(handlers: ChatChannelHandlers): Promise<{
  channel: RealtimeChannel;
  trackPresence: () => Promise<void>;
  broadcastTyping: (isTyping: boolean) => Promise<void>;
  currentUserId: string;
  currentEmail: string;
}> {
  const supabase = client();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const user = userData.user;

  // Private: joining, presence and typing broadcasts are authorised by the
  // realtime.messages policies (supabase/2026-10-06-chat-realtime-private.sql),
  // so only role holders can see who is online or send "typing". A public
  // channel answered to the bare anon key (audit run-5).
  const channel = supabase.channel(CHAT_REALTIME_TOPIC, {
    config: { private: true, presence: { key: user.id } },
  });

  channel.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "chat_messages" },
    (payload) => handlers.onInsert(payload.new as ChatMessageRow),
  );
  channel.on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "chat_messages" },
    (payload) => handlers.onUpdate(payload.new as ChatMessageRow),
  );
  channel.on(
    "postgres_changes",
    { event: "DELETE", schema: "public", table: "chat_messages" },
    (payload) => {
      const old = payload.old as { id?: string };
      if (old?.id) handlers.onDelete(old.id);
    },
  );

  channel.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "chat_message_votes" },
    (payload) => handlers.onVoteInsert(payload.new as ChatVoteRow),
  );
  channel.on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "chat_message_votes" },
    (payload) => handlers.onVoteUpdate(payload.new as ChatVoteRow),
  );
  channel.on(
    "postgres_changes",
    { event: "DELETE", schema: "public", table: "chat_message_votes" },
    (payload) => {
      const old = payload.old as { message_id?: string; user_id?: string };
      if (old?.message_id && old?.user_id) {
        handlers.onVoteDelete({ message_id: old.message_id, user_id: old.user_id });
      }
    },
  );

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState<{ user_id: string; email: string; online_at: string }>();
    const users: ChatPresenceUser[] = [];
    for (const key of Object.keys(state)) {
      const entries = state[key];
      const first = entries[0];
      if (!first) continue;
      users.push({
        user_id: first.user_id ?? key,
        email: first.email ?? "unknown",
        online_at: first.online_at ?? new Date().toISOString(),
      });
    }
    handlers.onPresence(users);
  });

  channel.on("broadcast", { event: "typing" }, (msg) => {
    const payload = msg.payload as TypingPayload | undefined;
    if (!payload || payload.user_id === user.id) return;
    handlers.onTyping(payload);
  });

  // We resolve on the first SUBSCRIBED. Every subsequent SUBSCRIBED is a
  // reconnect and triggers `onReconnect` so the caller can patch any gap in
  // the message stream that occurred while we were offline.
  let resolved = false;
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        if (!resolved) {
          resolved = true;
          resolve();
        } else {
          handlers.onReconnect?.();
        }
      } else if (!resolved && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) {
        reject(err ?? new Error(`Realtime channel status: ${status}`));
      }
    });
  });

  const trackPresence = async () => {
    await channel.track({
      user_id: user.id,
      email: user.email ?? "unknown",
      online_at: new Date().toISOString(),
    });
  };

  const broadcastTyping = async (isTyping: boolean) => {
    await channel.send({
      type: "broadcast",
      event: "typing",
      payload: {
        user_id: user.id,
        email: user.email ?? "unknown",
        is_typing: isTyping,
      } satisfies TypingPayload,
    });
  };

  return {
    channel,
    trackPresence,
    broadcastTyping,
    currentUserId: user.id,
    currentEmail: user.email ?? "unknown",
  };
}

/** Returns a stable YYYY-MM-DD key for grouping messages by local day. */
export function dayKeyFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Friendly day separator label: "Today", "Yesterday", or e.g. "Mon, Apr 14". */
export function formatDaySeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const todayKey = dayKeyFromIso(now.toISOString());
  const targetKey = dayKeyFromIso(iso);
  if (todayKey === targetKey) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKeyFromIso(yesterday.toISOString()) === targetKey) return "Yesterday";
  // Show year only when it isn't the current year.
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatChatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const part = local.split(/[._-]/)[0] ?? local;
  if (!part) return email;
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]/).filter(Boolean);
  const a = parts[0]?.[0] ?? local[0] ?? "?";
  const b = parts[1]?.[0] ?? local[1] ?? "";
  return (a + b).toUpperCase();
}

/**
 * Reduce an array of vote rows into a per-message summary (counts + the
 * current viewer's vote).
 */
export function summarizeVotes(
  votes: ChatVoteRow[],
  currentUserId: string | null,
): Map<string, VoteSummary> {
  const out = new Map<string, VoteSummary>();
  for (const v of votes) {
    const cur = out.get(v.message_id) ?? { up: 0, down: 0, mine: 0 as const };
    if (v.vote === 1) cur.up += 1;
    else if (v.vote === -1) cur.down += 1;
    if (currentUserId && v.user_id === currentUserId) cur.mine = v.vote;
    out.set(v.message_id, cur);
  }
  return out;
}
