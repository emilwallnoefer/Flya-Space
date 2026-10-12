"use client";

import { useEffect, useRef, useState } from "react";

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
 * by the time we hydrate), never before the title has been on screen for a
 * second (so a fast load reads as an opening, not a flicker), and never later
 * than a hard cap so a slow asset can't leave the page covered. When the
 * launch page at "/" handed over (html[data-launch-warm], see app/layout.tsx),
 * the title has been on screen since before this document existed: the
 * second then counts from the moment that page appeared, which it leaves in
 * the sessionStorage flag. Both fades are finite, as the no-perpetual-
 * animation rule requires, and the node leaves the DOM when done so nothing
 * lingers over the glass stack.
 */
export const SPLASH_MIN_MS = 1000;
export const SPLASH_MAX_MS = 2500;
/** In step with the `out` animations in app/animations.css. */
const SPLASH_OUT_MS = 500;

/** How long the title has already been on screen when this document starts:
 * the launch page's time, from its hand-over flag, or nothing. */
function alreadyShownMs(): number {
  if (!document.documentElement.dataset.launchWarm) return 0;
  try {
    const since = Number(sessionStorage.getItem("ma_launch"));
    return since > 0 ? Math.max(0, Date.now() - since) : 0;
  } catch {
    return 0;
  }
}

type Phase = "in" | "out" | "done";

export function LaunchSplash() {
  const [phase, setPhase] = useState<Phase>("in");
  const wordRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const started = performance.now();
    const minMs = Math.max(0, SPLASH_MIN_MS - alreadyShownMs());
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

    // On the way out the title shrinks into the page's own name (the navbar's
    // "Flya Space", or the phone home's greeting), marked data-launch-target.
    // FLIP: measure both now, hand the delta to the CSS animation as custom
    // properties. No target on this page (login, say): a plain fade.
    const aimAtTarget = () => {
      const word = wordRef.current;
      const target = document.querySelector<HTMLElement>("[data-launch-target]");
      if (!word || !target) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const from = word.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      if (!from.width || !to.width || !to.height) return;
      const scale = Math.min(to.height / from.height, to.width / from.width);
      word.style.setProperty("--merge-x", `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
      word.style.setProperty("--merge-y", `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
      word.style.setProperty("--merge-scale", String(scale));
      word.dataset.merge = "";
    };

    const release = () => {
      if (released) return;
      released = true;
      // Keep the opening whole: wait out whatever is left of the second.
      const wait = Math.max(0, minMs - (performance.now() - started));
      timers.push(
        window.setTimeout(() => {
          aimAtTarget();
          setPhase("out");
        }, wait),
      );
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
      <div className="launch-splash-word" ref={wordRef}>
        The Flya Space
      </div>
      <div className="launch-splash-sub">Flyability</div>
    </div>
  );
}
