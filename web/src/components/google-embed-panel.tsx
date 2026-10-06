"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { withRange, type GoogleEmbed } from "@/lib/google-embeds";

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-ink-2 transition ease-fluid hover:bg-glass/12 hover:text-ink";

/**
 * Sheets are shown at 80%: more of the grid fits, and Google has no URL switch
 * for its own zoom. The frame is laid out at 125% and scaled back down, so the
 * sheet believes its window is that much larger and draws more rows and columns.
 */
const SHEET_ZOOM = 0.8;

/** How long to wait for today's cell before opening the sheet at its top. */
const TODAY_TIMEOUT_MS = 3000;

const COPY: Record<GoogleEmbed["kind"], { hint: string; app: string; frame: string }> = {
  sheet: {
    hint: "Edits save to Google under your name. Blank? Sign in to Google, then reload. On Safari, open it in Google Sheets.",
    app: "Google Sheets",
    frame: "sheet",
  },
  form: {
    hint: "Your answers are sent with your Google account. Blank? Sign in to Google, then reload. On Safari, open it in Google Forms.",
    app: "Google Forms",
    frame: "form",
  },
};

/**
 * One Google Sheet or Form (Mission planning, Fleet management, Road Days), as
 * Google's own UI in a frame. See lib/google-embeds.ts for why it is an iframe
 * and who sees it.
 *
 * It takes over the whole window: a slim bar on top (back, title, and a quiet
 * "Not loading?" that reveals the fixes) and the page below. It is portalled to <body> so no transformed or
 * backdrop-filtered ancestor can turn `fixed` into "fixed to that ancestor".
 *
 * The page underneath stops scrolling while it is open. A scrollable page under
 * the frame is what stole the wheel: whatever the sheet did not consume chained
 * up to the page and moved it instead of the grid.
 *
 * Mission planning and Fleet management open scrolled to today: the server
 * finds today's cell and it goes into the URL as `range=` (lib/google-embeds.ts).
 * The frame waits briefly for it; without it, the sheet opens at its top.
 *
 * The frame is cross-origin, so the page cannot tell whether it shows the
 * content or a sign-in prompt. The hidden buttons cover both escape hatches:
 * sign in on Google in a new tab and reload the frame, or skip the frame entirely.
 */
export function GoogleEmbedPanel({
  title,
  urls,
  onBack,
}: {
  title: string;
  urls: GoogleEmbed;
  onBack: () => void;
}) {
  const [frameKey, setFrameKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  // undefined while today's cell is being looked up; null when there is none.
  const [todayCell, setTodayCell] = useState<string | null | undefined>(urls.today ? undefined : null);
  const copy = COPY[urls.kind];
  const zoom = urls.kind === "sheet" ? SHEET_ZOOM : 1;
  const embedUrl = withRange(urls.embed, todayCell);
  const openUrl = withRange(urls.open, todayCell);

  useEffect(() => {
    if (!urls.today) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TODAY_TIMEOUT_MS);
    fetch(`/api/google-embeds/today?sheet=${urls.today}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (body: { cell?: string | null } | null) => body?.cell ?? null,
        () => null,
      )
      .then((cell) => {
        if (!cancelled) setTodayCell(cell);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [urls.today]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col gap-1.5 bg-surface p-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className={BUTTON_CLASS}>
            <span aria-hidden>←</span> Workspace
          </button>
          <h1 className="truncate text-xs font-semibold text-ink">{title}</h1>
          {showHelp ? <p className="hidden truncate text-[11px] text-ink-4 lg:block">{copy.hint}</p> : null}
        </div>
        {/* The page cannot see into Google's frame, so it cannot tell a working
            sheet from a sign-in wall. The fixes stay one click away instead of
            cluttering the bar for everyone it already works for. */}
        {showHelp ? (
          <div className="flex flex-wrap gap-1.5">
            <a href={urls.signIn} target="_blank" rel="noopener noreferrer" className={BUTTON_CLASS}>
              Sign in to Google
            </a>
            <button type="button" onClick={() => setFrameKey((key) => key + 1)} className={BUTTON_CLASS}>
              Reload
            </button>
            <a href={openUrl} target="_blank" rel="noopener noreferrer" className={BUTTON_CLASS}>
              Open in {copy.app} ↗
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="text-[11px] text-ink-5 underline-offset-2 transition hover:text-ink-3 hover:underline"
          >
            Not loading?
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-glass/10 bg-white">
        {todayCell === undefined ? null : (
          <iframe
            key={frameKey}
            src={embedUrl}
            title={`${title} ${copy.frame}`}
            allow="clipboard-read; clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
