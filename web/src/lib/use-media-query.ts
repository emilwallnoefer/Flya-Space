"use client";

import { useSyncExternalStore } from "react";

/**
 * A media query as React state.
 *
 * The rule for phone/desktop differences: anything that is part of the first
 * paint is decided in CSS (Tailwind's `sm:` prefix, `@media` blocks), never
 * here — the server cannot know the screen width, so a hook-driven layout
 * would flash the wrong one before hydration. This hook is for *behaviour*
 * only: which way a sheet animates, whether a module switch pushes a history
 * entry, whether the keyboard needs handling. The server snapshot is `false`,
 * so the first client render matches the server and corrects itself after.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `sm` breakpoint: the phone layout (bottom tab bar, full-screen sheets). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 639px)");
}

/** A finger rather than a mouse: no hover, so touch targets must be visible and large. */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery("(hover: none) and (pointer: coarse)");
}
