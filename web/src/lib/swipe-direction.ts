/**
 * Decides whether a finished touch was a sideways swipe. Used by the phone's
 * Time Tracker to step between weeks. A swipe must travel far enough and be
 * clearly more sideways than vertical, so scrolling the page never flips the week.
 */
export const SWIPE_MIN_PX = 60;

export function swipeDirection(dx: number, dy: number, minPx = SWIPE_MIN_PX): "left" | "right" | null {
  if (Math.abs(dx) < minPx) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "left" : "right";
}
