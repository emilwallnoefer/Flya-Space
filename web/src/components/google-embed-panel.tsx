"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { withRange, type GoogleEmbed } from "@/lib/google-embeds";
import { todayCell as lookUpTodayCell } from "@/lib/google-embed-today-client";
import { lockPageScroll } from "@/lib/scroll-lock";
import { useIsMobile } from "@/lib/use-media-query";

const BUTTON_CLASS =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-ink-2 transition ease-fluid hover:bg-glass/12 hover:text-ink sm:min-h-0";

/**
 * Sheets are shown at 80%: more of the grid fits, and Google has no URL switch
 * for its own zoom. The frame is laid out at 125% and scaled back down, so the
 * sheet believes its window is that much larger and draws more rows and columns.
 */
const SHEET_ZOOM = 0.8;

/**
 * How long the frame holds back for today's cell. The dashboard asks for it on
 * mount, so it is usually already known; past this, the sheet starts loading
 * without it and is moved to today when the cell arrives.
 */
const TODAY_GRACE_MS = 800;

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
 * The dashboard starts that lookup on mount (lib/google-embed-today-client.ts),
 * so the frame rarely waits. When the cell comes late, the sheet has already
 * started loading at its top, and the cell is added to the frame's URL hash
 * once it has loaded — a hash change scrolls the sheet in place, where changing
 * the URL mid-load would throw away the load and start over.
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
  // What the frame shows. Unset only during the short grace for today's cell.
  const [frameSrc, setFrameSrc] = useState<string | null>(urls.today ? null : urls.embed);
  const frameLoaded = useRef(false);
  const copy = COPY[urls.kind];
  // Phones get the sheet at 1:1 — Google's touch targets are already small.
  const isMobile = useIsMobile();
  const zoom = urls.kind === "sheet" && !isMobile ? SHEET_ZOOM : 1;
  const openUrl = withRange(urls.open, todayCell);

  useEffect(() => {
    if (!urls.today) return;
    let cancelled = false;
    const grace = window.setTimeout(() => {
      if (!cancelled) setFrameSrc((src) => src ?? urls.embed);
    }, TODAY_GRACE_MS);
    void lookUpTodayCell(urls.today).then((cell) => {
      if (cancelled) return;
      window.clearTimeout(grace);
      setTodayCell(cell);
      // Before the grace ran out: the frame starts on today. After it, the
      // frame is already loading, so only a loaded frame is moved (onLoad
      // covers the other case).
      setFrameSrc((src) => (src === null || frameLoaded.current ? withRange(urls.embed, cell) : src));
    });
    return () => {
      cancelled = true;
      window.clearTimeout(grace);
    };
  }, [urls.today, urls.embed]);

  function handleFrameLoad() {
    if (frameLoaded.current) return;
    frameLoaded.current = true;
    if (todayCell) setFrameSrc(withRange(urls.embed, todayCell));
  }

  function reloadFrame() {
    frameLoaded.current = false;
    setFrameKey((key) => key + 1);
  }

  // The page behind the frame must not scroll (lib/scroll-lock.ts: the
  // variant iOS honours).
  useEffect(() => lockPageScroll(), []);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col gap-1.5 bg-surface p-1.5 pt-[max(0.375rem,var(--safe-top))] pb-[max(0.375rem,var(--safe-bottom))]">
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
            <button type="button" onClick={reloadFrame} className={BUTTON_CLASS}>
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
            className="min-h-9 text-[11px] text-ink-5 underline-offset-2 transition hover:text-ink-3 hover:underline sm:min-h-0"
          >
            Not loading?
          </button>
        )}
      </div>
      {/* Below lg the hint does not fit the bar; it gets its own line instead of vanishing. */}
      {showHelp ? <p className="px-1 text-[11px] text-ink-4 lg:hidden">{copy.hint}</p> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-glass/10 bg-white">
        {frameSrc === null ? null : (
          <iframe
            key={frameKey}
            src={frameSrc}
            onLoad={handleFrameLoad}
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
