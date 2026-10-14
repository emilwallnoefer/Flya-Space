"use client";

import { AnimatePresence, m } from "framer-motion";
import { initialsFromEmail, shortNameFromEmail, type ChatMessageRow } from "@/lib/chat";
import { excerpt, type ChatMember } from "@/lib/chat-mentions";
import { XMarkIcon } from "./icons";

/**
 * The two things that can sit on top of the composer, shared by the desktop
 * panel and the phone screen: the @-mention picker and the "replying to"
 * strip. Both are look-agnostic and take their state from `useChat`.
 */

export function MentionPicker({
  candidates,
  activeIndex,
  onPick,
  onHover,
}: {
  candidates: ChatMember[];
  activeIndex: number;
  onPick: (member: ChatMember) => void;
  onHover: (index: number) => void;
}) {
  return (
    <AnimatePresence>
      {candidates.length > 0 ? (
        <m.ul
          key="mention-picker"
          role="listbox"
          aria-label="People to mention"
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-60 overflow-y-auto rounded-2xl border border-glass/15 bg-panel p-1 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)] ring-1 ring-glass/5"
        >
          {candidates.map((member, index) => {
            const active = index === activeIndex;
            return (
              <li key={member.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  // mousedown, not click: a click would first blur the
                  // textarea and take the caret with it.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(member);
                  }}
                  onMouseEnter={() => onHover(index)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                    active ? "bg-accent/15 text-ink" : "text-ink-2 hover:bg-glass/8"
                  }`}
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-neutral to-panel text-[11px] font-semibold text-ink"
                    aria-hidden
                  >
                    {initialsFromEmail(member.email)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{member.name}</span>
                    <span className="block truncate text-[11px] text-ink-4">{member.email}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </m.ul>
      ) : null}
    </AnimatePresence>
  );
}

export function ReplyStrip({
  target,
  currentUserId,
  onCancel,
}: {
  target: ChatMessageRow | null;
  currentUserId: string | null;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {target ? (
        <m.div
          key={`reply-${target.id}`}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-accent bg-glass/6 px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-accent-soft">
                Replying to {target.sender_id === currentUserId ? "yourself" : shortNameFromEmail(target.sender_email)}
              </p>
              <p className="truncate text-xs text-ink-3">{excerpt(target.body, target.attachment_name, 90) || "Message"}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel reply"
              className="group grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition hover:bg-glass/10 hover:text-ink"
            >
              <XMarkIcon className="h-3 w-3 transition-transform duration-200 group-hover:rotate-90" />
            </button>
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
