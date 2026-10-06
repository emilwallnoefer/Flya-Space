import type { Metadata } from "next";
import { OfflineScreen } from "@/components/offline-screen";

export const metadata: Metadata = { title: "Offline · Flya Space" };

/**
 * What the service worker (`public/sw.js`) serves when a page cannot load
 * because there is no connection — this app's answer to the browser's dino.
 *
 * The worker fetches and caches this page (and the scripts it needs) while the
 * app is online, so it must stay public and carry nothing personal: it is
 * served to whoever is at the keyboard, signed in or not. That is also why it
 * is outside `SESSION_PATHS` in `proxy.ts`.
 */
export default function OfflinePage() {
  return <OfflineScreen />;
}
