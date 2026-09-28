"use client";

import { AnimatePresence, m } from "framer-motion";
import { type ReactNode, useRef } from "react";
import { Toast } from "@/components/ui";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  dayKeyFromIso,
  formatDaySeparator,
  messageKindLabel,
} from "@/lib/chat";
import { playUiSound } from "@/lib/ui-sounds";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChatBubbleIcon,
  PaperclipIcon,
  SendIcon,
  SpinnerIcon,
  XMarkIcon,
} from "./icons";
import { CertificateRequestModal } from "./certificate-request-modal";
import { MessageRow } from "./message-row";
import {
  DaySeparator,
  FilterStrip,
  KindToggleRow,
  PresenceAvatars,
  TypingStrip,
} from "./panel-chrome";
import type { ChatWidgetProps } from "./types";
import { useChat } from "./use-chat";

export function ChatWidget(props: ChatWidgetProps) {
  const chat = useChat(props);
  const {
    bottomOffsetRem,
    isAdmin,
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
    visibleMessages,
    voteSummary,
    hasMoreHistory,
    loadingMore,
    handleLoadOlder,
    scrollRef,
    handleScroll,
    scrollToBottom,
    isAtBottom,
    pendingNew,
    draft,
    handleDraftChange,
    handleKeyDown,
    handlePaste,
    pendingKind,
    setPendingKind,
    sendState,
    fileInputRef,
    handleSend,
    handleAttachmentPick,
    currentUserEmail,
    certificateOpen,
    setCertificateOpen,
    certificateSending,
    certificateSent,
    handleCertificateSubmit,
    filter,
    setFilter,
    filterCounts,
    editingId,
    setEditingId,
    handleSaveEdit,
    handleDelete,
    handleVote,
    handleMarkDone,
    pendingUndo,
    handleUndoDelete,
    lightbox,
    setLightbox,
  } = chat;

  const panelRef = useRef<HTMLElement>(null);
  // Trap focus in the panel while it's open; suspend it when the image
  // lightbox or the certificate form (separate dialogs layered on top) takes
  // over, so the two traps don't fight over focus.
  useFocusTrap(panelRef, open && !lightbox && !certificateOpen);

  return (
    <>
      {/* Hide the floating trigger pill when the panel is open — it would
          otherwise visibly stick out behind the bottom-right corner of the
          floating "iPhone" panel. */}
      <AnimatePresence>
        {!open && !props.onClose ? (
          <m.button
            key="chat-trigger"
            type="button"
            aria-label="Open team chat"
            initial={{ opacity: 0, scale: 0.85, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 12 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              playUiSound("switchWhoosh");
              setOpen(true);
            }}
            style={{ bottom: `${bottomOffsetRem}rem` }}
            className="fixed right-4 z-[125] inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/95 px-4 py-3 text-sm font-semibold text-slate-900 shadow-[0_18px_36px_-12px_rgba(34,211,238,0.55)] backdrop-blur transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ChatBubbleIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Team chat</span>
            {unread > 0 ? (
              <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-ink">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </m.button>
        ) : null}
      </AnimatePresence>

      {/* Visually hidden live region for screen readers — updated with the
          last incoming message so SR users hear it without the panel needing
          to be open. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <AnimatePresence onExitComplete={props.onClose}>
        {open ? (
          <>
            <m.div
              key="chat-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[130] bg-overlay/45 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <m.aside
              key="chat-panel"
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-label="Team chat"
              initial={{ opacity: 0, scale: 0.9, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 18 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              style={{ transformOrigin: "bottom right" }}
              className="fixed bottom-5 right-5 z-[131] flex h-[calc(100dvh-2.5rem)] max-h-[780px] w-[min(94vw,380px)] flex-col rounded-[2.75rem] bg-gradient-to-b from-neutral/80 via-panel to-surface p-[6px] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.75),0_10px_30px_-10px_rgba(0,0,0,0.6)] ring-1 ring-glass/10"
            >
              {/* Inner "screen" — content lives here; rounded slightly less than the frame so the bezel reads as a thin band. */}
              <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[2.3rem] bg-surface ring-1 ring-inset ring-glass/5">
                {/* Compact one-row header: identity on the left, presence + close on the right. */}
                <header className="flex items-center gap-2 border-b border-glass/10 bg-gradient-to-b from-white/[0.06] to-transparent px-4 py-2.5">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-from/30 to-accent-to/30 ring-1 ring-inset ring-glass/15">
                    <ChatBubbleIcon className="h-4 w-4 text-accent-soft" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-ink">Team chat</h2>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-4">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          onlineCount > 0 ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" : "bg-neutral"
                        }`}
                        aria-hidden
                      />
                      <span>{onlineCount === 0 ? "Connecting…" : `${onlineCount} online`}</span>
                    </div>
                  </div>
                  <PresenceAvatars
                    users={presence}
                    currentUserId={currentUserId}
                    open={presenceOpen}
                    setOpen={setPresenceOpen}
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="group grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-glass/10 bg-glass/5 text-ink-3 transition hover:border-glass/20 hover:bg-glass/10 hover:text-ink"
                  >
                    <XMarkIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-90" />
                  </button>
                </header>

                <FilterStrip filter={filter} setFilter={setFilter} counts={filterCounts} />

                <div className="relative flex-1 overflow-hidden">
                  <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="absolute inset-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
                  >
                    {hasMoreHistory ? (
                      <div className="flex justify-center pb-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleLoadOlder();
                          }}
                          disabled={loadingMore}
                          className="inline-flex items-center gap-1.5 rounded-full border border-glass/10 bg-glass/5 px-3 py-1 text-[11px] text-ink-3 transition hover:border-glass/20 hover:bg-glass/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingMore ? (
                            <SpinnerIcon className="h-3 w-3 animate-spin" />
                          ) : (
                            <ArrowUpIcon className="h-3 w-3" />
                          )}
                          {loadingMore ? "Loading…" : "Load older"}
                        </button>
                      </div>
                    ) : null}

                    {loading ? (
                      <p className="text-center text-xs text-ink-4">Loading conversation…</p>
                    ) : visibleMessages.length === 0 ? (
                      <p className="mt-8 text-center text-xs text-ink-4">
                        {filter === "all"
                          ? "No messages yet. Say hi to your team."
                          : "Nothing here. Try a different filter or post a new one below."}
                      </p>
                    ) : (
                      <AnimatePresence initial={false}>
                        {(() => {
                          const items: ReactNode[] = [];
                          let lastDayKey: string | null = null;
                          visibleMessages.forEach((msg, i) => {
                            const dayKey = dayKeyFromIso(msg.created_at);
                            const isNewDay = dayKey !== lastDayKey;
                            if (isNewDay) {
                              items.push(
                                <DaySeparator
                                  key={`sep-${dayKey}`}
                                  label={formatDaySeparator(msg.created_at)}
                                />,
                              );
                              lastDayKey = dayKey;
                            }
                            const previous = isNewDay ? undefined : visibleMessages[i - 1];
                            const showHeader =
                              !previous ||
                              previous.sender_id !== msg.sender_id ||
                              previous.kind !== msg.kind ||
                              new Date(msg.created_at).getTime() -
                                new Date(previous.created_at).getTime() >
                                5 * 60 * 1000;
                            items.push(
                              <m.div
                                key={msg.id}
                                className="chat-msg-row"
                                layout="position"
                                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                transition={{ duration: 0.18, ease: "easeOut" }}
                              >
                                <MessageRow
                                  message={msg}
                                  isMe={msg.sender_id === currentUserId}
                                  showHeader={showHeader}
                                  isAdmin={isAdmin}
                                  isEditing={editingId === msg.id}
                                  votes={voteSummary.get(msg.id)}
                                  onStartEdit={() => setEditingId(msg.id)}
                                  onCancelEdit={() => setEditingId(null)}
                                  onSaveEdit={(body) => handleSaveEdit(msg.id, body)}
                                  onDelete={() => handleDelete(msg.id)}
                                  onVote={(next) =>
                                    handleVote(msg.id, voteSummary.get(msg.id)?.mine ?? 0, next)
                                  }
                                  onMarkDone={(done) => handleMarkDone(msg.id, done)}
                                  onOpenImage={(url, name) => setLightbox({ url, name })}
                                />
                              </m.div>,
                            );
                          });
                          return items;
                        })()}
                      </AnimatePresence>
                    )}
                  </div>

                  {/* Jump-to-bottom pill — appears when the user has scrolled
                      up and new messages have arrived. */}
                  <AnimatePresence>
                    {!isAtBottom && pendingNew > 0 ? (
                      <m.button
                        key="jump-pill"
                        type="button"
                        onClick={scrollToBottom}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        whileTap={{ scale: 0.95 }}
                        className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/90 px-3 py-1 text-[11px] font-semibold text-slate-900 shadow-[0_6px_18px_-6px_rgba(34,211,238,0.6)] backdrop-blur"
                      >
                        <ArrowDownIcon className="h-3 w-3" />
                        {pendingNew} new {pendingNew === 1 ? "message" : "messages"}
                      </m.button>
                    ) : null}
                  </AnimatePresence>
                </div>

                <TypingStrip names={otherTypingNames} />

                <AnimatePresence>
                  {pendingUndo ? (
                    <Toast
                      key="undo-toast"
                      tone="neutral"
                      action={{ label: "Undo", onClick: handleUndoDelete }}
                      className="mx-3 mb-2"
                    >
                      Message deleted
                    </Toast>
                  ) : null}
                </AnimatePresence>

                <AnimatePresence>
                  {certificateSent ? (
                    <Toast key="certificate-toast" tone="positive" className="mx-3 mb-2">
                      Certificate request sent to the admins
                    </Toast>
                  ) : null}
                </AnimatePresence>

                <AnimatePresence>
                  {error ? (
                    <m.div
                      key="error-banner"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="flex items-center justify-between gap-2 border-t border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-danger"
                      role="alert"
                    >
                      <span className="min-w-0 flex-1 truncate">{error}</span>
                      <button
                        type="button"
                        onClick={() => setError(null)}
                        aria-label="Dismiss error"
                        className="group grid h-5 w-5 shrink-0 place-items-center rounded-md text-danger transition hover:bg-rose-500/20"
                      >
                        <XMarkIcon className="h-3 w-3 transition-transform duration-200 group-hover:rotate-90" />
                      </button>
                    </m.div>
                  ) : null}
                </AnimatePresence>

                <div className="border-t border-glass/10 bg-overlay/70 px-3 py-3">
                  <KindToggleRow
                    pendingKind={pendingKind}
                    setPendingKind={setPendingKind}
                    onOpenCertificate={() => setCertificateOpen(true)}
                  />
                  <div className="mt-2 flex items-end gap-2 rounded-2xl border border-glass/12 bg-glass/5 px-2 py-1.5 focus-within:border-accent/50 focus-within:bg-glass/[0.07]">
                    <button
                      type="button"
                      aria-label="Attach file"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sendState === "sending"}
                      className="group grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-3 transition hover:bg-glass/10 hover:text-ink disabled:opacity-50"
                    >
                      <PaperclipIcon className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        void handleAttachmentPick(e);
                      }}
                    />
                    <textarea
                      rows={1}
                      value={draft}
                      onChange={handleDraftChange}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder={
                        pendingKind === "message"
                          ? "Message your team…"
                          : `Posting as ${messageKindLabel(pendingKind).toLowerCase()}…`
                      }
                      className="min-h-9 max-h-32 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-ink placeholder:text-ink-5 focus:outline-none focus:ring-0"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        handleSend();
                      }}
                      disabled={sendState === "sending" || draft.trim().length === 0}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/90 text-slate-900 shadow-[0_4px_14px_-4px_rgba(34,211,238,0.6)] transition hover:bg-accent disabled:cursor-not-allowed disabled:bg-neutral/35 disabled:text-ink-4 disabled:shadow-none"
                      aria-label="Send"
                    >
                      {sendState === "sending" ? (
                        <SpinnerIcon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SendIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </m.aside>

            {/* Certificate-request form — layered above the panel, below the
                lightbox. */}
            <AnimatePresence>
              {certificateOpen ? (
                <CertificateRequestModal
                  key="certificate-modal"
                  currentUserEmail={currentUserEmail}
                  submitting={certificateSending}
                  onSubmit={handleCertificateSubmit}
                  onClose={() => {
                    if (!certificateSending) setCertificateOpen(false);
                  }}
                />
              ) : null}
            </AnimatePresence>

            {/* Image lightbox overlay (rendered last so it sits on top of the
                panel and the backdrop). */}
            <AnimatePresence>
              {lightbox ? (
                <m.div
                  key="chat-lightbox"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-[140] flex items-center justify-center bg-surface/90 p-4 backdrop-blur"
                  onClick={() => setLightbox(null)}
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Image preview: ${lightbox.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lightbox.url}
                    alt={lightbox.name}
                    className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={() => setLightbox(null)}
                    aria-label="Close preview"
                    className="group absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-glass/20 bg-panel/80 text-ink transition hover:bg-raised"
                  >
                    <XMarkIcon className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
                  </button>
                </m.div>
              ) : null}
            </AnimatePresence>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
