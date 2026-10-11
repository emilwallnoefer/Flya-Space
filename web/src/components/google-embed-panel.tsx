"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { withRange, type GoogleEmbed } from "@/lib/google-embeds";
import { todayCell as lookUpTodayCell } from "@/lib/google-embed-today-client";
import { lockPageScroll } from "@/lib/scroll-lock";

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-ink-2 transition ease-fluid hover:bg-glass/12 hover:text-ink";

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

/**
 * Phones only: how long the frame gets before the "Still blank?" card comes
 * up. The page cannot see whether the frame shows the sheet or Google's
 * refused sign-in, so the card is timed, not triggered, and stays dismissible.
 */
const BLANK_HINT_DELAY_MS = 2500;
const BLANK_HINT_DISMISSED_KEY = "ma_google_frame_hint_dismissed_v1";

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
 * and who sees it. The phone shell mounts it too, with `phoneHint`: WebKit
 * gives the frame no Google session unless Safari's cross-site tracking
 * prevention is off (same file), so on phones a card with that setting and
 * the way out to Google comes up after a moment, until it is dismissed once.
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
  phoneHint,
}: {
  title: string;
  urls: GoogleEmbed;
  onBack: () => void;
  /** The phone's "Still blank?" card: where the link out goes (the tile's ↗ URL, with the work account). */
  phoneHint?: { openHref: string };
}) {
  const [frameKey, setFrameKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  // undefined while today's cell is being looked up; null when there is none.
  const [todayCell, setTodayCell] = useState<string | null | undefined>(urls.today ? undefined : null);
  // What the frame shows. Unset only during the short grace for today's cell.
  const [frameSrc, setFrameSrc] = useState<string | null>(urls.today ? null : urls.embed);
  const frameLoaded = useRef(false);
  const copy = COPY[urls.kind];
  const zoom = urls.kind === "sheet" ? SHEET_ZOOM : 1;
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
  // variant iOS honours; overflow: hidden on <html> is ignored there).
  useEffect(() => lockPageScroll(), []);

  // Phones: the Safari card after a moment, unless dismissed on this device.
  useEffect(() => {
    if (!phoneHint) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(BLANK_HINT_DISMISSED_KEY) === "1";
    } catch {
      // Storage blocked: show it.
    }
    if (dismissed) return;
    const timer = window.setTimeout(() => setHintOpen(true), BLANK_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phoneHint]);

  function dismissHint() {
    setHintOpen(false);
    try {
      window.localStorage.setItem(BLANK_HINT_DISMISSED_KEY, "1");
    } catch {
      // Ignore.
    }
  }

  function revealHelp() {
    setShowHelp(true);
    if (phoneHint) setHintOpen(true);
  }

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
            onClick={revealHelp}
            className="text-[11px] text-ink-5 underline-offset-2 transition hover:text-ink-3 hover:underline"
          >
            Not loading?
          </button>
        )}
      </div>
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
        {phoneHint && hintOpen ? (
          <div
            role="dialog"
            aria-labelledby="google-frame-hint-title"
            className="absolute inset-x-3 bottom-3 rounded-2xl border border-glass/15 bg-panel p-4 text-ink shadow-lg"
          >
            <h2 id="google-frame-hint-title" className="text-[15px] font-semibold">
              Still blank?
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-ink-3">
              Safari keeps your Google sign-in away from pages shown inside other apps. To see the {copy.frame} here, open iPhone{" "}
              <strong className="font-medium text-ink">Settings → Apps → Safari</strong> and turn off{" "}
              <strong className="font-medium text-ink">Prevent Cross-Site Tracking</strong>, then tap Reload. It is a device-wide
              privacy setting: it also lets other websites follow you across sites. Or open it in Google instead.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={phoneHint.openHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-accent px-3.5 text-[14px] font-medium text-slate-950 active:bg-accent-deep"
              >
                Open in {copy.app} ↗
              </a>
              <button
                type="button"
                onClick={reloadFrame}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-glass/15 bg-glass/8 px-3.5 text-[14px] font-medium text-ink-2"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={dismissHint}
                className="ml-auto inline-flex min-h-10 items-center justify-center px-2 text-[14px] text-ink-4"
              >
                Don&apos;t show again
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
