import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme-attrs";

/**
 * Web app manifest, served at /manifest.webmanifest. It is what lets Safari's
 * "Add to Home Screen" install Flya Space as its own app: full screen, its own
 * icon, and — because `scope` covers the whole origin — the Google sign-in
 * round trip lands back inside the installed app rather than in Safari.
 *
 * No offline caching rides on this: public/sw.js stays the offline-game
 * fallback only (see .claude/rules/elios-game.md), so a `start_url` opened
 * with no network shows the game, never a stale copy of someone's data.
 *
 * Icons come from scripts/build-app-icons.mjs; edit src/brand/flya-space-icon.svg
 * and re-run it, not the PNGs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Flya Space",
    short_name: "Flya",
    description: "Flyability's internal workspace: time tracking, team chat, fleet and mail.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
