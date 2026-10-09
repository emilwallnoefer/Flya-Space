"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { EliosGame } from "@/components/elios-game";
import { readOnline, subscribeOnline } from "@/lib/online-status";

/**
 * The offline page: the game, and a way back once the connection returns.
 *
 * It does not reload on its own when the browser comes back online — that
 * would throw away a run in progress. It offers instead.
 *
 * `leaderboard` is on even though there is no network: the board simply fails
 * to load, a finished run is queued in localStorage, and both catch up the
 * moment the browser reports it is online again.
 *
 * The server snapshot is "offline", unlike everywhere else: the service worker
 * caches this page's HTML while the browser is online, but only ever shows it
 * when it is not, so the server-rendered first frame should say so.
 */
const readOfflineOnServer = () => false;

export function OfflineScreen() {
  const online = useSyncExternalStore(subscribeOnline, readOnline, readOfflineOnServer);

  return (
    <main
      id="main-content"
      className="relative grid min-h-dvh grid-rows-[1fr_auto_1fr] overflow-x-hidden bg-surface px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-ink"
    >
      <div aria-hidden className="pointer-events-none fixed inset-0 aurora-bg" />
      {/* The game holds the optical centre; the status sits just above it. */}
      <div className="relative flex items-end justify-center pb-5">
        <h1 className="inline-flex items-center gap-2 rounded-full border border-glass/20 bg-surface/70 px-3.5 py-1.5 text-sm font-medium backdrop-blur">
          <span
            aria-hidden
            className={`size-2 rounded-full ${online ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`}
          />
          {online ? "Back online" : "You’re offline"}
        </h1>
      </div>
      <EliosGame className="relative mx-auto w-full max-w-xl" leaderboard />
      {/* On a phone the button sits at the bottom, under the thumb; on a
          wider screen it follows the game rather than stranding at the edge. */}
      <div className="relative mx-auto flex w-full max-w-xl flex-col justify-end pt-6 sm:justify-start">
        <Button
          type="button"
          variant="glass"
          size="md"
          className="w-full"
          onClick={() => {
            // The worker serves this page in place of the one that failed, so
            // reloading retries that page. Opened directly, there is nothing
            // to retry — go to the workspace instead. A full load either way:
            // this page may be a cached copy from an older build, so its
            // client router cannot be trusted to know the current one.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            if (window.location.pathname === "/offline") window.location.assign("/dashboard");
            else window.location.reload();
          }}
        >
          {online ? "Back to the workspace" : "Try again"}
        </Button>
      </div>
    </main>
  );
}
