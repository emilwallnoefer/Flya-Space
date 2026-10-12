"use client";

import { m } from "framer-motion";
import { useEffect, useLayoutEffect, type ReactNode } from "react";

/** 1 = going deeper (push), -1 = going back (pop). */
export type NavDirection = 1 | -1;

/** Strong ease-out for things arriving on screen. */
export const SCREEN_EASE = [0.23, 1, 0.32, 1] as const;
/** iOS sheet curve: fast start, long soft landing. */
export const SHEET_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * One screen of the phone's stack. When `screenKey` changes the content
 * remounts and slides in from the side it came from (push: from the right,
 * pop: from the left), so a change of screen reads as a move, not a cut.
 * The page scrolls to the top at the same moment, because the new screen
 * starts at its top. Only transform and opacity animate; there is no exit
 * animation, so the outgoing screen never overlaps the incoming one and the
 * input path stays free (the next tap lands on the new screen at once).
 * Under Reduce Motion the MotionConfig keeps the fade and drops the slide.
 */
// The first screen of a page load does not slide in: the launch camera is
// the entrance, and it measures the header while this would still be moving.
// Every later screen change slides as before.
let firstScreenShown = false;

export function MobileScreen({ screenKey, direction, children }: { screenKey: string; direction: NavDirection; children: ReactNode }) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [screenKey]);
  useEffect(() => {
    firstScreenShown = true;
  }, []);
  const initial = firstScreenShown ? { opacity: 0, x: direction * 28 } : false;
  return (
    <m.div key={screenKey} initial={initial} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, ease: SCREEN_EASE }}>
      {children}
    </m.div>
  );
}
