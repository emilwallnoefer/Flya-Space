"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { MissionPlanningUrls } from "@/lib/mission-planning";

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-ink-2 transition ease-fluid hover:bg-glass/12 hover:text-ink";

/** Gap kept below the panel, in px. */
const BOTTOM_GAP = 8;

/**
 * The "Mission planning" tab, as Google's own editor in a frame. See
 * lib/mission-planning.ts for why it is an iframe and who sees it.
 *
 * The panel fills the viewport from where it starts down to the bottom edge,
 * and the page itself stops scrolling while it is open. A scrollable page under
 * the frame is what stole the wheel: whatever the sheet did not consume chained
 * up to the page and moved it instead of the grid. With no page scroll there is
 * nothing to chain to.
 *
 * The frame is cross-origin, so the page cannot tell whether it shows the sheet
 * or a sign-in prompt. The buttons cover both escape hatches: sign in on Google
 * in a new tab and reload the frame, or skip the frame entirely.
 */
export function MissionPlanningPanel({ urls }: { urls: MissionPlanningUrls }) {
  const [frameKey, setFrameKey] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    window.scrollTo(0, 0);
    root.style.overflow = "hidden";

    const fit = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const top = panel.getBoundingClientRect().top;
      setHeight(Math.max(320, Math.floor(window.innerHeight - top - BOTTOM_GAP)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      root.style.overflow = previous;
    };
  }, []);

  return (
    <div
      ref={panelRef}
      style={height ? { height } : undefined}
      // Breaks out of the page column to the window edges (minus 0.5rem a side);
      // 100vw is exact here because the page has no scrollbar while this is open.
      className="glass-card mx-[calc(50%-50vw+0.5rem)] flex h-[calc(100dvh-9rem)] flex-col gap-2 p-1.5 md:p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="hidden text-[11px] text-ink-4 md:block">
          Live sheet: edits save to Google under your name. Blank? Sign in to Google, then reload. On Safari, open it in
          Google Sheets.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <a href={urls.signIn} target="_blank" rel="noopener noreferrer" className={BUTTON_CLASS}>
            Sign in to Google
          </a>
          <button type="button" onClick={() => setFrameKey((key) => key + 1)} className={BUTTON_CLASS}>
            Reload
          </button>
          <a href={urls.open} target="_blank" rel="noopener noreferrer" className={BUTTON_CLASS}>
            Open in Google Sheets ↗
          </a>
        </div>
      </div>
      <iframe
        key={frameKey}
        src={urls.embed}
        title="Mission planning sheet"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
        className="min-h-0 w-full flex-1 rounded-xl border border-glass/10 bg-white"
      />
    </div>
  );
}
