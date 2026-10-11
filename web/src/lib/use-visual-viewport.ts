"use client";

import { useEffect, useState } from "react";

export type VisualViewportBox = { top: number; height: number };

/** Below this the viewport change is the URL bar or a rotation, not a keyboard. */
const KEYBOARD_MIN_PX = 150;

/**
 * The part of the window the user can actually see, as inline-style numbers.
 *
 * iOS Safari does not shrink the layout viewport for the on-screen keyboard:
 * `100dvh` stays the full height and the bottom of a sheet (its composer)
 * ends up under the keys. `window.visualViewport` does know, so while
 * `enabled` the hook follows its `resize`/`scroll` events and returns the
 * box a full-screen sheet should fill. Null when disabled, unsupported or
 * no keyboard is up, so the CSS size applies. Event-driven only — no polling, no RAF loop.
 */
export function useVisualViewport(enabled: boolean): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    function update() {
      const vv = window.visualViewport;
      if (!vv) return;
      // Safari may scroll the page to reveal a focused field; with the sheet
      // pinned to the visual viewport that only leaves a gap, so undo it.
      // Only the keyboard shrinks the visual viewport by this much; the URL
      // bar's few pixels are not worth pinning for, and a pinned sheet that
      // was never keyboard-sized would change height when the pin lifts.
      if (window.innerHeight - vv.height < KEYBOARD_MIN_PX) {
        setBox(null);
        return;
      }
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      setBox({ top: vv.offsetTop, height: vv.height });
    }
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return enabled ? box : null;
}
