/**
 * The camera behind the launch: pure geometry, no DOM.
 *
 * The app opens with the page (`.launch-stage`) transformed so that the
 * header's wordmark sits exactly where the splash title is, at the same
 * size; the camera then pulls back to identity. Both rects are measured
 * with `getBoundingClientRect` at scroll 0, each including its element's own
 * `scaleX(1.18)`, which cancels in the ratio. The stage's transform-origin
 * is 0 0, so a page point p maps to s·p + t.
 *
 * Scale follows a geometric path (s^(1-p)) rather than a linear one: a
 * linear scale front-loads the zoom (4 → 2.5 is "half the view" in the
 * first 40 %), geometric keeps the perceived rate even. The title's centre
 * moves on a straight line from the splash centre to its resting place.
 */

export type Rect = { left: number; top: number; width: number; height: number };

export type Camera = { s: number; tx: number; ty: number };

/** Hard limits on a sane camera: below, not worth a move; above, absurd. */
export const CAMERA_MIN_SCALE = 1.05;
export const CAMERA_MAX_SCALE = 12;

/** The move and the reveals that ride on it, in milliseconds. */
export const MOVE_MS = 1500;
export const MOVE_EASING = "cubic-bezier(0.6, 0, 0.1, 1)";
export const REVEAL_START_MS = 450;
export const REVEAL_STEP_MS = 70;
export const REVEAL_MS = 520;
export const LATE_MS = 300;
export const KEYFRAME_COUNT = 24;

function centre(r: Rect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The transform that puts `header` exactly over `overlay`. */
export function cameraTransform(overlay: Rect, header: Rect): Camera {
  const s = overlay.width / header.width;
  const o = centre(overlay);
  const h = centre(header);
  return { s, tx: o.x - s * h.x, ty: o.y - s * h.y };
}

export function isSaneCamera(c: Camera): boolean {
  return (
    Number.isFinite(c.s) &&
    Number.isFinite(c.tx) &&
    Number.isFinite(c.ty) &&
    c.s >= CAMERA_MIN_SCALE &&
    c.s <= CAMERA_MAX_SCALE
  );
}

export function transformString(c: Camera): string {
  const f = (n: number) => Number(n.toFixed(3));
  return `translate(${f(c.tx)}px, ${f(c.ty)}px) scale(${f(c.s)})`;
}

/**
 * Keyframes from the camera to identity. `count` segments, so count + 1
 * frames; the first is exactly the camera, the last exactly identity.
 */
export function cameraKeyframes(
  overlay: Rect,
  header: Rect,
  count = KEYFRAME_COUNT,
): { transform: string }[] {
  const { s } = cameraTransform(overlay, header);
  const o = centre(overlay);
  const h = centre(header);
  const frames: { transform: string }[] = [];
  for (let k = 0; k <= count; k++) {
    const p = k / count;
    const sk = k === count ? 1 : Math.pow(s, 1 - p);
    const cx = o.x + p * (h.x - o.x);
    const cy = o.y + p * (h.y - o.y);
    frames.push({ transform: transformString({ s: sk, tx: cx - sk * h.x, ty: cy - sk * h.y }) });
  }
  return frames;
}

/** When reveal element `i` starts, relative to the start of the move. */
export function revealDelay(i: number, start = REVEAL_START_MS, step = REVEAL_STEP_MS): number {
  return start + i * step;
}

/** When the whole choreography is over: the move or the last reveal, whichever is later. */
export function choreographyEnd(maxIndex: number, moveMs = MOVE_MS): number {
  return Math.max(moveMs, revealDelay(maxIndex) + REVEAL_MS);
}
