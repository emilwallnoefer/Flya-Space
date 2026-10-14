"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatChatTimestamp,
  initialsFromEmail,
  isMarkableKind,
  isVotableKind,
  shortNameFromEmail,
  type ChatMessageRow,
  type MessageKind,
  type VoteSummary,
} from "@/lib/chat";
import { canEditChatMessage, chatEditTimeLeft } from "@/lib/chat-edit-window";
import { excerpt, splitMentions, type ChatMember } from "@/lib/chat-mentions";
import { AttachmentBlock } from "./attachment-block";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilSquareIcon,
  ReplyIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import { KIND_META } from "./types";

/** Shared base for the small pill buttons in the floating action row. */
const ACTION_PILL_BASE =
  "inline-flex items-center gap-1 rounded-md border border-glass/12 bg-glass/5 px-1.5 py-0.5 text-[11px] text-ink-3 transition";
/** Shared base for the up/down vote pills (their active/idle colors are appended). */
const VOTE_PILL_BASE =
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50";

type MessageRowProps = {
  message: ChatMessageRow;
  isMe: boolean;
  showHeader: boolean;
  isAdmin: boolean;
  isEditing: boolean;
  votes?: VoteSummary;
  /** The team, for rendering @-mentions; empty until loaded (plain text then). */
  members?: ChatMember[];
  /** The viewer, so a mention of them stands out. */
  currentUserId?: string | null;
  /**
   * The message this one answers: the row when it is loaded, `"missing"` when
   * it is older than the loaded history (or was deleted), undefined for a
   * message that is not a reply.
   */
  replyTo?: ChatMessageRow | "missing";
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => void;
  onDelete: () => void;
  onVote: (next: -1 | 1) => void;
  onMarkDone: (done: boolean) => void;
  onOpenImage: (url: string, name: string) => void;
  onReply?: () => void;
  onJumpTo?: (messageId: string) => void;
};

const NO_MEMBERS: ChatMember[] = [];

export function MessageRow({
  message,
  isMe,
  showHeader,
  isAdmin,
  isEditing,
  votes,
  members = NO_MEMBERS,
  currentUserId = null,
  replyTo,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onVote,
  onMarkDone,
  onOpenImage,
  onReply,
  onJumpTo,
}: MessageRowProps) {
  const initials = initialsFromEmail(message.sender_email);
  const name = shortNameFromEmail(message.sender_email);
  const tagged = message.kind !== "message";
  const meta = tagged ? KIND_META[message.kind as Exclude<MessageKind, "message">] : null;
  const isDone = Boolean(message.done_at);
  const canEdit = useEditWindowOpen(message.created_at, isMe);

  return (
    <div
      className={`chat-message-row group flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}
      data-chat-message-id={message.id}
    >
      <div className="w-7 shrink-0">
        {showHeader ? (
          <span
            className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold ${
              isMe
                ? "bg-gradient-to-br from-accent-from to-accent-to text-slate-950"
                : "bg-gradient-to-br from-neutral to-panel text-ink"
            }`}
            aria-hidden
          >
            {initials}
          </span>
        ) : null}
      </div>
      <div className={`flex min-w-0 max-w-[78%] flex-col ${isMe ? "items-end" : "items-start"}`}>
        {showHeader ? (
          <p className="mb-0.5 text-[11px] text-ink-4">
            {isMe ? "You" : name} · {formatChatTimestamp(message.created_at)}
            {message.edited_at ? <span className="ml-1 italic text-ink-5">(edited)</span> : null}
          </p>
        ) : null}

        {tagged && meta ? (
          <div className={`mb-1 inline-flex items-center gap-1.5 ${isMe ? "flex-row-reverse" : ""}`}>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badgeBorder} ${meta.badgeBg} ${meta.badgeText} ${
                isDone ? "opacity-60 saturate-50" : ""
              }`}
            >
              <meta.Icon className="h-3 w-3" />
              {meta.shortLabel}
            </span>
            {isDone ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-300/55 bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-positive"
                title="Marked as done by an admin"
              >
                <CheckIcon className="h-3 w-3" /> Done
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Relative wrapper: anchors the floating action bar to the bubble itself. */}
        <div className="relative min-w-0 max-w-full">
          <div
            className={`chat-bubble rounded-2xl px-3 py-2 text-sm leading-relaxed transition ${
              isMe
                ? "rounded-br-sm bg-accent/90 text-slate-900"
                : "rounded-bl-sm bg-glass/8 text-ink"
            } ${isDone ? "opacity-65 saturate-50" : ""}`}
          >
            {replyTo ? <ReplyQuote target={replyTo} darkText={isMe} currentUserId={currentUserId} onJumpTo={onJumpTo} /> : null}
            {isEditing ? (
              <EditField initialBody={message.body ?? ""} onSave={onSaveEdit} onCancel={onCancelEdit} />
            ) : message.body ? (
              <p
                className={`whitespace-pre-wrap break-words ${
                  isDone ? "line-through decoration-ink-4/70 decoration-2" : ""
                }`}
              >
                <MessageBody body={message.body} members={members} darkText={isMe} currentUserId={currentUserId} />
              </p>
            ) : null}
            {message.attachment_path ? (
              <AttachmentBlock message={message} darkText={isMe} onOpenImage={onOpenImage} />
            ) : null}
          </div>

          {/* Action row: votes + per-message actions, floats over the bubble. */}
          {!isEditing ? (
            <MessageActions
              isMe={isMe}
              canEdit={canEdit}
              isAdmin={isAdmin}
              isDone={isDone}
              kind={message.kind}
              votes={votes}
              onVote={onVote}
              onStartEdit={onStartEdit}
              onDelete={onDelete}
              onMarkDone={onMarkDone}
              onReply={onReply}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Whether the sender can still edit: true for the first 10 minutes, then
 *  flips once on a timer (no ticking clock). */
function useEditWindowOpen(createdAt: string, isMe: boolean): boolean {
  const [open, setOpen] = useState(() => isMe && canEditChatMessage(createdAt));
  useEffect(() => {
    if (!isMe) return;
    const timer = window.setTimeout(() => setOpen(false), chatEditTimeLeft(createdAt));
    return () => window.clearTimeout(timer);
  }, [createdAt, isMe]);
  return open;
}

/** The body with `@Name` mentions as chips; the viewer's own name stands out. */
function MessageBody({
  body,
  members,
  darkText,
  currentUserId,
}: {
  body: string;
  members: ChatMember[];
  darkText: boolean;
  currentUserId: string | null;
}) {
  const parts = splitMentions(body, members);
  if (parts.length === 1 && parts[0].type === "text") return <>{body}</>;
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "text") return <span key={index}>{part.value}</span>;
        const me = part.member.id === currentUserId;
        return (
          <span
            key={index}
            className={`rounded-md px-1 font-semibold ${
              darkText
                ? "bg-slate-900/15 text-slate-900"
                : me
                  ? "bg-amber-400/25 text-warn"
                  : "bg-accent/18 text-accent-soft"
            }`}
            title={part.member.email}
          >
            {part.value}
          </span>
        );
      })}
    </>
  );
}

/** The quoted original above a reply; tapping it scrolls to the message when it is loaded. */
function ReplyQuote({
  target,
  darkText,
  currentUserId,
  onJumpTo,
}: {
  target: ChatMessageRow | "missing";
  darkText: boolean;
  currentUserId: string | null;
  onJumpTo?: (messageId: string) => void;
}) {
  const tone = darkText ? "border-slate-900/50 bg-slate-900/10 text-slate-900" : "border-accent/70 bg-glass/8 text-ink-2";
  if (target === "missing") {
    return (
      <p className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs italic ${tone} opacity-80`}>Replying to an earlier message</p>
    );
  }
  const who = target.sender_id === currentUserId ? "You" : shortNameFromEmail(target.sender_email);
  const text = excerpt(target.body, target.attachment_name, 110) || "Message";
  return (
    <button
      type="button"
      onClick={() => onJumpTo?.(target.id)}
      className={`mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs transition hover:brightness-110 ${tone}`}
      aria-label={`Replying to ${who}: ${text}. Show the original.`}
    >
      <span className="block font-semibold">{who}</span>
      <span className="block truncate opacity-85">{text}</span>
    </button>
  );
}

function MessageActions({
  isMe,
  canEdit,
  isAdmin,
  isDone,
  kind,
  votes,
  onVote,
  onStartEdit,
  onDelete,
  onMarkDone,
  onReply,
}: {
  isMe: boolean;
  /** Within the 10-minute edit window (lib/chat-edit-window.ts). */
  canEdit: boolean;
  isAdmin: boolean;
  isDone: boolean;
  kind: MessageKind;
  votes?: VoteSummary;
  onVote: (next: -1 | 1) => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onMarkDone: (done: boolean) => void;
  onReply?: () => void;
}) {
  const showVotes = isVotableKind(kind);
  const showMark = isMarkableKind(kind) && isAdmin;
  if (!showVotes && !showMark && !isMe && !onReply) return null;

  const mine = votes?.mine ?? 0;
  return (
    <div className={`chat-actions-row ${isMe ? "is-me" : "is-other"}`}>
      {onReply ? (
        <button
          type="button"
          onClick={onReply}
          aria-label="Reply to this message"
          className={`${ACTION_PILL_BASE} hover:border-glass/20 hover:bg-glass/10`}
        >
          <ReplyIcon className="h-3 w-3" />
          <span>Reply</span>
        </button>
      ) : null}
      {showVotes ? (
        <>
          <button
            type="button"
            onClick={() => onVote(1)}
            disabled={isDone}
            aria-label={`Upvote (${votes?.up ?? 0})`}
            aria-pressed={mine === 1}
            className={`${VOTE_PILL_BASE} ${
              mine === 1
                ? "border-emerald-300/60 bg-emerald-400/15 text-positive"
                : "border-glass/12 bg-glass/5 text-ink-3 hover:border-glass/20 hover:bg-glass/10"
            }`}
          >
            <ArrowUpIcon className="h-3 w-3" />
            {(votes?.up ?? 0) > 0 ? <span>{votes!.up}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => onVote(-1)}
            disabled={isDone}
            aria-label={`Downvote (${votes?.down ?? 0})`}
            aria-pressed={mine === -1}
            className={`${VOTE_PILL_BASE} ${
              mine === -1
                ? "border-rose-300/60 bg-rose-400/15 text-danger"
                : "border-glass/12 bg-glass/5 text-ink-3 hover:border-glass/20 hover:bg-glass/10"
            }`}
          >
            <ArrowDownIcon className="h-3 w-3" />
            {(votes?.down ?? 0) > 0 ? <span>{votes!.down}</span> : null}
          </button>
        </>
      ) : null}
      {showMark ? (
        <button
          type="button"
          onClick={() => onMarkDone(!isDone)}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition ${
            isDone
              ? "border-amber-300/55 bg-amber-400/15 text-warn hover:bg-amber-400/25"
              : "border-emerald-300/55 bg-emerald-400/15 text-positive hover:bg-emerald-400/25"
          }`}
          title={isDone ? "Reopen this request" : "Mark as done"}
        >
          {isDone ? <UndoIcon className="h-3 w-3" /> : <CheckIcon className="h-3 w-3" />}
          <span>{isDone ? "Reopen" : "Mark done"}</span>
        </button>
      ) : null}
      {isMe ? (
        <>
          {canEdit ? (
            <button
              type="button"
              onClick={onStartEdit}
              aria-label="Edit message"
              className={`${ACTION_PILL_BASE} hover:border-glass/20 hover:bg-glass/10`}
            >
              <PencilSquareIcon className="h-3 w-3" />
              <span>Edit</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete message"
            className={`${ACTION_PILL_BASE} hover:border-rose-300/40 hover:bg-rose-500/15 hover:text-danger`}
          >
            <TrashIcon className="h-3 w-3" />
            <span>Delete</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function EditField({
  initialBody,
  onSave,
  onCancel,
}: {
  initialBody: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialBody);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div>
      <textarea
        ref={ref}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) onSave(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="min-h-[3rem] w-full resize-none rounded-md border border-slate-900/30 bg-glass/60 px-2 py-1.5 text-sm text-slate-900 focus:border-accent-deep focus:outline-none"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (value.trim()) onSave(value);
          }}
          className="rounded-md bg-panel px-2 py-0.5 text-[11px] font-semibold text-accent-soft hover:bg-raised"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-900/30 bg-glass/40 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-glass/60"
        >
          Cancel
        </button>
        <span className="ml-1 text-[11px] text-slate-700/70">Enter saves · Esc cancels</span>
      </div>
    </div>
  );
}
