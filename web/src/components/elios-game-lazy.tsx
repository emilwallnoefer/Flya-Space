"use client";

import dynamic from "next/dynamic";
import type { EliosGameProps } from "@/components/elios-game";

/**
 * The Elios game, split out of the dashboard's first bundle.
 *
 * The game and its renderer are ~180 KB of source, and on the dashboard it is
 * never the first thing anyone needs — it waits in the composer's preview slot
 * and in the offline card. Loading it with the shell made every cold start
 * download and parse it before the page could hydrate.
 *
 * The role gate uses it too, even though the game is its main content: it is
 * rendered by the same `dashboard/page.tsx`, and Next ships one set of client
 * chunks per page, so a static import there put the game in every dashboard
 * load. Only `offline-screen.tsx` keeps the static import — the offline page
 * must render from the service worker's cache without fetching anything more.
 */
const loadEliosGame = () => import("@/components/elios-game").then((m) => m.EliosGame);

/**
 * Starts the download without rendering anything. The offline card calls it
 * once the dashboard is idle, so the chunk is already in the browser cache by
 * the time a connection drops and the card has to show the game.
 */
export function preloadEliosGame(): void {
  void loadEliosGame().catch(() => {
    // Best-effort warm-up; a failure here just means the card loads it later.
  });
}

// Same 320:200 frame as the canvas (WORLD_WIDTH / WORLD_HEIGHT in
// lib/elios-flight.ts — not imported, since that would pull the rules module
// back into the first bundle), so nothing shifts when the game swaps in.
function EliosGamePlaceholder() {
  return (
    <div
      className="w-full rounded-xl border border-glass/20 bg-black"
      style={{ aspectRatio: "320 / 200" }}
      aria-hidden
    />
  );
}

const EliosGameDynamic = dynamic(loadEliosGame, { ssr: false, loading: EliosGamePlaceholder });

export function LazyEliosGame({ className, ...rest }: EliosGameProps) {
  // `className` goes on a wrapper so the placeholder sits exactly where the
  // game will (the game puts it on its own outer div, which then fills this).
  return (
    <div className={className}>
      <EliosGameDynamic {...rest} />
    </div>
  );
}
