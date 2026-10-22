/**
 * Where a floating box (tooltip, hover card) goes on screen. Pure, so the
 * rules are tested without a browser: try the preferred side of the anchor,
 * flip to the other side when it does not fit, then clamp into the viewport
 * so no edge of the box is ever off screen.
 */

export type FloatRect = { left: number; top: number; width: number; height: number };
export type FloatSize = { width: number; height: number };
export type FloatSide = "top" | "bottom";
export type FloatAlign = "start" | "center" | "end";

export const FLOAT_MARGIN = 8;

export function placeFloating({
  anchor,
  size,
  viewport,
  side = "bottom",
  align = "center",
  gap = 6,
  margin = FLOAT_MARGIN,
}: {
  anchor: FloatRect;
  size: FloatSize;
  viewport: FloatSize;
  side?: FloatSide;
  align?: FloatAlign;
  gap?: number;
  margin?: number;
}): { left: number; top: number; side: FloatSide } {
  const above = anchor.top - gap - size.height;
  const below = anchor.top + anchor.height + gap;
  const fitsAbove = above >= margin;
  const fitsBelow = below + size.height <= viewport.height - margin;

  let placed: FloatSide = side;
  if (side === "top" && !fitsAbove && fitsBelow) placed = "bottom";
  if (side === "bottom" && !fitsBelow && fitsAbove) placed = "top";

  const left =
    align === "start"
      ? anchor.left
      : align === "end"
        ? anchor.left + anchor.width - size.width
        : anchor.left + anchor.width / 2 - size.width / 2;

  return {
    left: clamp(left, margin, viewport.width - margin - size.width),
    top: clamp(placed === "top" ? above : below, margin, viewport.height - margin - size.height),
    side: placed,
  };
}

// A box wider than the room left between the margins pins to the start margin.
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
