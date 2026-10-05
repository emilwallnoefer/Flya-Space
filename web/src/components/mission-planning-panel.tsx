"use client";

import { useState } from "react";
import type { MissionPlanningUrls } from "@/lib/mission-planning";

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass/15 bg-glass/8 px-3 py-1.5 text-xs font-medium text-ink-2 transition ease-fluid hover:bg-glass/12 hover:text-ink";

/**
 * The "Mission planning" tab, as Google's own editor in a frame. See
 * lib/mission-planning.ts for why it is an iframe and who sees it.
 *
 * The frame is cross-origin, so the page cannot tell whether it shows the sheet
 * or a blank sign-in refusal. The buttons cover both escape hatches: sign in on
 * Google in a new tab and reload the frame, or skip the frame entirely.
 */
export function MissionPlanningPanel({ urls }: { urls: MissionPlanningUrls }) {
  const [frameKey, setFrameKey] = useState(0);

  return (
    <div className="glass-card space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-relaxed text-ink-4">
          The live planning sheet. Edits save straight to Google under your name. Blank or asking you to sign in? Sign
          in to Google, then reload. On Safari, open it in Google Sheets.
        </p>
        <div className="flex flex-wrap gap-2">
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
        className="h-[calc(100dvh-13rem)] min-h-[28rem] w-full rounded-xl border border-glass/10 bg-white"
      />
    </div>
  );
}
