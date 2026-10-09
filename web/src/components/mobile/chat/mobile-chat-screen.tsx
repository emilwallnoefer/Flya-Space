"use client";

import { AnimatePresence, m } from "framer-motion";
import { type ReactNode, useEffect, useRef } from "react";
import { CertificateRequestModal } from "@/components/chat/certificate-request-modal";
import { ArrowDownIcon, ArrowUpIcon, PaperclipIcon, SendIcon, SpinnerIcon, XMarkIcon } from "@/components/chat/icons";
import { MessageRow } from "@/components/chat/message-row";
import { DaySeparator, FilterStrip, KindToggleRow, PresenceAvatars, TypingStrip } from "@/components/chat/panel-chrome";
import { useChat } from "@/components/chat/use-chat";
import { Toast } from "@/components/ui";
import { dayKeyFromIso, formatDaySeparator, messageKindLabel } from "@/lib/chat";
import { lockPageScroll } from "@/lib/scroll-lock";
import { useVisualViewport } from "@/lib/use-visual-viewport";

/**
 * Team chat as a full-screen phone screen, on the shared `useChat` hook. The
 * message rows, the filter strip, the kind toggle, presence, the certificate
 * form and the lightbox are the desktop's components; only the frame is the
 * phone's: it fills the visual viewport (so the composer stays above the
 * keyboard), pins the page behind it, and closes with the top-bar ×.
 */
export function MobileChatScreen({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const chat = useChat({ isAdmin, onClose });
  const {
    loading,
    error,
    setError,
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

  const viewport = useVisualViewport(true);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => lockPageScroll(), []);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
      <m.div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Team chat"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
        style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}
        className="m-sheet fixed inset-0 z-[141] flex flex-col bg-surface text-ink"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-glass/10 bg-surface/95 px-3 pb-2 pt-[max(0.5rem,var(--safe-top))]">
          <div className="min-w-0 flex-1 pl-1">
            <h2 className="text-base font-semibold text-ink">Team chat</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-ink-4">
              <span className={`h-1.5 w-1.5 rounded-full ${onlineCount > 0 ? "bg-emerald-400" : "bg-neutral"}`} aria-hidden />
              {onlineCount === 0 ? "Connecting…" : `${onlineCount} online`}
            </p>
          </div>
          <PresenceAvatars users={presence} currentUserId={currentUserId} open={presenceOpen} setOpen={setPresenceOpen} />
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="shrink-0 px-2">
          <FilterStrip filter={filter} setFilter={setFilter} counts={filterCounts} />
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 [touch-action:pan-y]">
            {hasMoreHistory ? (
              <div className="flex justify-center pb-2">
                <button type="button" onClick={() => void handleLoadOlder()} disabled={loadingMore} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-glass/10 bg-glass/5 px-3 text-xs text-ink-3 disabled:opacity-60">
                  {loadingMore ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : <ArrowUpIcon className="h-3 w-3" />}
                  {loadingMore ? "Loading…" : "Load older"}
                </button>
              </div>
            ) : null}
            {loading ? (
              <p className="text-center text-xs text-ink-4">Loading conversation…</p>
            ) : visibleMessages.length === 0 ? (
              <p className="mt-8 text-center text-xs text-ink-4">{filter === "all" ? "No messages yet. Say hi to your team." : "Nothing here. Try a different filter."}</p>
            ) : (
              <AnimatePresence initial={false}>
                {(() => {
                  const items: ReactNode[] = [];
                  let lastDayKey: string | null = null;
                  visibleMessages.forEach((msg, i) => {
                    const dayKey = dayKeyFromIso(msg.created_at);
                    const isNewDay = dayKey !== lastDayKey;
                    if (isNewDay) {
                      items.push(<DaySeparator key={`sep-${dayKey}`} label={formatDaySeparator(msg.created_at)} />);
                      lastDayKey = dayKey;
                    }
                    const previous = isNewDay ? undefined : visibleMessages[i - 1];
                    const showHeader =
                      !previous ||
                      previous.sender_id !== msg.sender_id ||
                      previous.kind !== msg.kind ||
                      new Date(msg.created_at).getTime() - new Date(previous.created_at).getTime() > 5 * 60 * 1000;
                    items.push(
                      <m.div key={msg.id} className="chat-msg-row" layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
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
                          onVote={(next) => handleVote(msg.id, voteSummary.get(msg.id)?.mine ?? 0, next)}
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
          <AnimatePresence>
            {!isAtBottom && pendingNew > 0 ? (
              <m.button key="jump" type="button" onClick={scrollToBottom} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-3 left-1/2 inline-flex min-h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-slate-900 shadow-lg">
                <ArrowDownIcon className="h-3 w-3" />
                {pendingNew} new
              </m.button>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="shrink-0">
          <TypingStrip names={otherTypingNames} />
          <AnimatePresence>
            {pendingUndo ? (
              <Toast key="undo" tone="neutral" action={{ label: "Undo", onClick: handleUndoDelete }} className="mx-3 mb-2">
                Message deleted
              </Toast>
            ) : null}
            {certificateSent ? (
              <Toast key="cert" tone="positive" className="mx-3 mb-2">
                Certificate request sent to the admins
              </Toast>
            ) : null}
          </AnimatePresence>
          {error ? (
            <div className="flex items-center justify-between gap-2 border-t border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-danger" role="alert">
              <span className="min-w-0 flex-1 truncate">{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="grid h-8 w-8 place-items-center rounded-md">
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          ) : null}
          <div className="border-t border-glass/10 bg-panel px-3 pt-2 pb-[max(0.5rem,var(--safe-bottom))]">
            <KindToggleRow pendingKind={pendingKind} setPendingKind={setPendingKind} onOpenCertificate={() => setCertificateOpen(true)} />
            <div className="mt-2 flex items-end gap-1.5 rounded-2xl border border-glass/12 bg-glass/5 px-1.5 py-1 focus-within:border-accent/50">
              <button type="button" aria-label="Attach file" onClick={() => fileInputRef.current?.click()} disabled={sendState === "sending"} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-3 active:bg-glass/10 disabled:opacity-50">
                <PaperclipIcon className="h-5 w-5" />
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void handleAttachmentPick(e)} />
              <textarea
                rows={1}
                value={draft}
                onChange={handleDraftChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={pendingKind === "message" ? "Message your team…" : `Posting as ${messageKindLabel(pendingKind).toLowerCase()}…`}
                className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-base text-ink placeholder:text-ink-5 focus:outline-none focus:ring-0"
              />
              <button type="button" onClick={() => handleSend()} disabled={sendState === "sending" || draft.trim().length === 0} aria-label="Send" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-slate-900 disabled:bg-neutral/35 disabled:text-ink-4">
                {sendState === "sending" ? <SpinnerIcon className="h-5 w-5 animate-spin" /> : <SendIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </m.div>

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
      <AnimatePresence>
        {lightbox ? (
          <m.div key="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] flex items-center justify-center bg-surface/95 p-4" onClick={() => setLightbox(null)} role="dialog" aria-modal="true" aria-label={`Image preview: ${lightbox.name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.name} className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
            <button type="button" onClick={() => setLightbox(null)} aria-label="Close preview" className="absolute right-4 top-[max(1rem,var(--safe-top))] grid h-11 w-11 place-items-center rounded-full bg-panel/80 text-ink">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
