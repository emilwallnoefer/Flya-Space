"use client";

import { useEffect, useRef, useState } from "react";
import {
  cameraKeyframes,
  cameraTransform,
  choreographyEnd,
  isSaneCamera,
  LATE_MS,
  MOVE_EASING,
  MOVE_MS,
  REVEAL_START_MS,
  REVEAL_STEP_MS,
  transformString,
  type Rect,
} from "@/lib/launch-camera";
import { whenLaunchReady } from "@/lib/launch-ready";
import { NAVBAR_TITLE } from "@/components/workspace-home-layout";

/**
 * The opening shot. The screen shows "The Flya Space" big; that title is the
 * page's own header title with the camera pushed all the way in. The camera
 * then pulls back in one move until the page is in frame, and the rest of
 * the page materialises as it comes into view.
 *
 * Mechanically: a fixed overlay (this component, in the server HTML so it
 * paints before hydration, in the device's skin via CSS keyed on <html>)
 * holds the title while the page loads underneath. When the real page is
 * up (lib/launch-ready.ts), the title has been on screen for a second, and
 * the fonts are in, the overlay title and the header title (the element
 * marked data-launch-target) are measured and the page wrapper
 * (`.launch-stage`, app/layout.tsx) is transformed so the header title sits
 * exactly under the overlay's, at the same size (lib/launch-camera.ts).
 * That frame is painted once under the opaque overlay, so the page is
 * rastered at the zoomed scale; next frame the overlay is removed (a hard
 * cut: the page shows the same title on the same colour, every decoration
 * being a reveal still hidden) and the stage animates to identity. Elements marked data-launch-reveal fade in
 * on a stagger keyed on html[data-launch-zoom]; fixed chrome marked
 * data-launch-late waits for html[data-launch-settle], once the transform
 * is gone (a fixed element inside a transformed ancestor is mispositioned).
 *
 * Nothing outlives the move: the attributes, the inline transform and the
 * custom properties are all removed, and the overlay leaves the DOM. Every
 * animation is finite. Without a target on the page, under Reduce Motion,
 * on a scrolled reload, or if the geometry check fails, the overlay just
 * fades (plain fade), and the page is never covered for longer than the
 * hard cap.
 */
export const SPLASH_MIN_MS = 1000;
/** After the document has loaded, how long to wait for the real page. */
export const LAUNCH_READY_CAP_MS = 3000;
/** Never cover the page longer than this, whatever happens. */
export const SPLASH_MAX_MS = 6000;
/** In step with the plain-fade animation in app/animations.css. */
const FADE_MS = 200;
/** Post-apply tolerance between the two titles, in CSS px. */
const SWAP_TOLERANCE_PX = 2;

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

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function maxDeviation(a: Rect, b: Rect): number {
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );
}

function highestRevealIndex(): number {
  let max = 0;
  document.querySelectorAll<HTMLElement>("[data-launch-reveal]").forEach((el) => {
    const i = Number(el.style.getPropertyValue("--reveal-i"));
    if (Number.isFinite(i) && i > max) max = i;
  });
  return max;
}

type Phase = "in" | "fade" | "done";

export function LaunchSplash() {
  const [phase, setPhase] = useState<Phase>("in");
  const wordRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const stage = document.querySelector<HTMLElement>(".launch-stage");
    const timers: number[] = [];
    let animation: Animation | null = null;
    let cancelled = false;
    const after = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(() => (cancelled ? undefined : fn()), ms));
    };
    const delay = (ms: number) => new Promise<void>((resolve) => after(ms, resolve));

    // The launch page's hand-over flag has done its job once we are on
    // screen; clear it here rather than in the bootstrap so a redirect hop
    // in between cannot use it up (a reload a minute later fades in again).
    const hold = delay(Math.max(0, SPLASH_MIN_MS - alreadyShownMs()));
    try {
      sessionStorage.removeItem("ma_launch");
    } catch {
      // Storage unavailable: nothing to clear.
    }

    const loaded =
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
    const readyOrCap = Promise.race([
      whenLaunchReady(),
      loaded.then(() => delay(LAUNCH_READY_CAP_MS)),
      delay(SPLASH_MAX_MS),
    ]);

    const letGo = () => {
      html.style.removeProperty("--launch-reveal-start");
      html.style.removeProperty("--launch-reveal-step");
      delete html.dataset.launchZoom;
    };

    const plainFade = () => {
      setPhase("fade");
      after(FADE_MS, () => setPhase("done"));
    };

    const camera = () => {
      const word = wordRef.current;
      const target = document.querySelector<HTMLElement>("[data-launch-target]");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!stage || !word || !target || reduced || window.scrollY > 0) return plainFade();
      if (!document.fonts.check('700 11px "Syncopate"')) return plainFade();

      const overlay = rectOf(word);
      const header = rectOf(target);
      const cam = cameraTransform(overlay, header);
      if (!isSaneCamera(cam)) return plainFade();

      // The opening frame: page zoomed so the header title is under the
      // overlay's, everything marked for reveal hidden, overflow clipped.
      // Same task as the measurement, so nothing paints in between.
      html.dataset.launchZoom = "";
      stage.style.transform = transformString(cam);
      const headerAtCamera = rectOf(target);
      const off = maxDeviation(headerAtCamera, overlay);
      window.dispatchEvent(
        new CustomEvent("flya:launch-trace", {
          detail: { overlay, target: header, targetAtT0: headerAtCamera, ...cam, off },
        }),
      );
      if (off > SWAP_TOLERANCE_PX) {
        stage.style.transform = "";
        delete html.dataset.launchZoom;
        return plainFade();
      }

      // Let that frame paint under the overlay (the page is rastered at the
      // zoomed scale, so the pull-back is a crisp downscale), then go.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          html.style.setProperty("--launch-reveal-start", `${REVEAL_START_MS}ms`);
          html.style.setProperty("--launch-reveal-step", `${REVEAL_STEP_MS}ms`);
          animation = stage.animate(cameraKeyframes(overlay, header), {
            duration: MOVE_MS,
            easing: MOVE_EASING,
            fill: "both",
          });
          // A hard cut: the page under the overlay is the same title on the
          // same page colour (decorations are reveals, still hidden), so
          // removing the overlay changes no pixel; a fade would only dim the
          // page's title through the scrim for a moment.
          setPhase("done");
          after(choreographyEnd(highestRevealIndex()) + 50, letGo);
          animation.finished
            .then(() => {
              if (cancelled) return;
              // Inline transform first, then the animation: no frame in
              // between, so nothing jumps; the page is at its true size.
              stage.style.transform = "";
              animation?.cancel();
              animation = null;
              html.dataset.launchSettle = "";
              after(LATE_MS + 50, () => delete html.dataset.launchSettle);
            })
            .catch(() => {
              // Cancelled by the cleanup below.
            });
        });
      });
    };

    Promise.all([hold, document.fonts.ready, readyOrCap]).then(() => {
      if (!cancelled) camera();
    });

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      animation?.cancel();
      if (stage) stage.style.transform = "";
      letGo();
      delete html.dataset.launchSettle;
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
      <div className="brand-wordmark launch-splash-word" ref={wordRef}>
        {NAVBAR_TITLE}
      </div>
    </div>
  );
}
