"use client";

import { useEffect, useState } from "react";

/**
 * Full-screen wordmark shown the moment a page is opened, so the app feels
 * instant: the page colour is painted before anything else has arrived, and
 * the title fades in while the real page loads underneath.
 *
 * Rendered by the root layout, so it is in the server HTML and paints before
 * hydration. Its colours come from CSS keyed on the <html> appearance
 * attributes (app/animations.css, `.launch-splash`): a saved or cached skin
 * reads the skin's own tokens; an account that never chose one, and anyone
 * not signed in, gets Neumorphism. The fade-in is a CSS animation, so no JS
 * is needed to start it; this component only decides when to let go.
 *
 * It goes once the document has loaded (`window.load`, or already complete
 * by the time we hydrate), never before the fade-in has finished, and never
 * later than a hard cap so a slow asset can't leave the page covered. When
 * the launch page at "/" handed over (html[data-launch-warm], see
 * app/layout.tsx), the title has been on screen since before this document
 * existed, so there is no fade-in to protect and it goes as soon as loaded. Both
 * fades are finite, as the no-perpetual-animation rule requires, and the
 * node leaves the DOM when done so nothing lingers over the glass stack.
 */
export const SPLASH_MIN_MS = 650;
export const SPLASH_MAX_MS = 2500;
const SPLASH_OUT_MS = 360;

type Phase = "in" | "out" | "done";

export function LaunchSplash() {
  const [phase, setPhase] = useState<Phase>("in");

  useEffect(() => {
    const started = performance.now();
    const minMs = document.documentElement.dataset.launchWarm ? 0 : SPLASH_MIN_MS;
    // The launch page's hand-over flag has done its job once we are on screen;
    // clear it here rather than in the bootstrap so a redirect hop in between
    // cannot use it up (then a reload a minute later fades in as usual).
    try {
      sessionStorage.removeItem("ma_launch");
    } catch {
      // Storage unavailable: nothing to clear.
    }
    const timers: number[] = [];
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      // Keep the fade-in whole: wait out whatever is left of the minimum.
      const wait = Math.max(0, minMs - (performance.now() - started));
      timers.push(window.setTimeout(() => setPhase("out"), wait));
      timers.push(
        window.setTimeout(() => setPhase("done"), wait + SPLASH_OUT_MS),
      );
    };

    if (document.readyState === "complete") release();
    else window.addEventListener("load", release, { once: true });
    timers.push(window.setTimeout(release, SPLASH_MAX_MS));

    return () => {
      window.removeEventListener("load", release);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className="launch-splash"
      data-phase={phase}
      role="status"
      aria-label="Flya Space is loading"
    >
      <div className="launch-splash-word">The Flya Space</div>
      <div className="launch-splash-sub">Flyability</div>
    </div>
  );
}
