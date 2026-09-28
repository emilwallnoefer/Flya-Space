"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { LazyEliosGame, preloadEliosGame } from "@/components/elios-game-lazy";
import { flushPendingScore } from "@/lib/elios-score-sync";
import { readOnline, readOnlineOnServer, subscribeOnline } from "@/lib/online-status";

/**
 * The game, offered when the connection drops while the dashboard is open.
 *
 * The service worker covers a page that cannot load (`public/sw.js`), but the
 * dashboard is a single page: once it is up, losing the connection never fails
 * a navigation, so that fallback would never be seen. This card is the same
 * idea for a page that is already open.
 *
 * It also posts any score flown while away the moment the browser is back
 * online — whether or not a game is on screen to do it — so a run flown on the
 * offline page reaches the board the next time the workspace is opened.
 *
 * The card stays up after the connection returns, so a run in progress is not
 * yanked away; it only switches its heading. Closing it holds until the next
 * outage.
 */
export function OfflineGameCard() {
  const online = useSyncExternalStore(subscribeOnline, readOnline, readOnlineOnServer);
  const [card, setCard] = useState<"idle" | "open" | "dismissed">("idle");

  useEffect(() => {
    const onOffline = () => setCard("open");
    const onOnline = () => {
      void flushPendingScore();
    };
    void flushPendingScore();
    // The game is not in the dashboard's first bundle. Fetch it once the page
    // is idle so it is already cached when the connection drops — by then it
    // is too late to download it.
    // (Safari has no requestIdleCallback; a timeout is close enough there.)
    if ("requestIdleCallback" in window) window.requestIdleCallback(preloadEliosGame, { timeout: 5000 });
    else setTimeout(preloadEliosGame, 2000);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const visible = card === "open" || (!online && card !== "dismissed");
  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={online ? "Back online" : "You're offline"}
      className="fixed bottom-4 left-4 z-[125] w-[min(92vw,24rem)] rounded-xl border border-glass/20 bg-surface/95 p-4 text-ink shadow-xl backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/75">
            {online ? "Connection is back" : "No connection"}
          </p>
          <p className="mt-1 text-sm text-ink-3/85">
            {online
              ? "Finish your run — your score goes on the leaderboard."
              : "Fly while you wait. Scores are saved and posted once you’re back."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCard("dismissed")}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded-md px-2 py-1 text-ink-4 transition hover:bg-glass/10 hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/70"
        >
          ✕
        </button>
      </div>
      <LazyEliosGame className="mt-3" leaderboard />
    </div>
  );
}
