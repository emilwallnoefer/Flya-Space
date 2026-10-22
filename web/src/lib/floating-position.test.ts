import { describe, expect, it } from "vitest";
import { placeFloating } from "./floating-position";

const viewport = { width: 1000, height: 800 };
const size = { width: 256, height: 60 };
const icon = (left: number, top: number) => ({ left, top, width: 14, height: 14 });

function inside(pos: { left: number; top: number }) {
  expect(pos.left).toBeGreaterThanOrEqual(8);
  expect(pos.top).toBeGreaterThanOrEqual(8);
  expect(pos.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(pos.top + size.height).toBeLessThanOrEqual(viewport.height - 8);
}

describe("placeFloating", () => {
  it("sits below the anchor, start-aligned, when there is room", () => {
    const pos = placeFloating({ anchor: icon(100, 100), size, viewport, align: "start" });
    expect(pos).toEqual({ left: 100, top: 120, side: "bottom" });
  });

  it("slides left instead of running off the right edge (the clipped stat-card tooltip)", () => {
    const pos = placeFloating({ anchor: icon(900, 100), size, viewport, align: "start" });
    expect(pos.left).toBe(1000 - 8 - 256);
    inside(pos);
  });

  it("slides right instead of running off the left edge", () => {
    const pos = placeFloating({ anchor: icon(4, 100), size, viewport, align: "end" });
    expect(pos.left).toBe(8);
    inside(pos);
  });

  it("flips above when there is no room below", () => {
    const pos = placeFloating({ anchor: icon(100, 770), size, viewport });
    expect(pos.side).toBe("top");
    expect(pos.top).toBe(770 - 6 - 60);
    inside(pos);
  });

  it("flips below when a top-preferring box has no room above", () => {
    const pos = placeFloating({ anchor: icon(100, 20), size, viewport, side: "top" });
    expect(pos.side).toBe("bottom");
    inside(pos);
  });

  it("keeps the preferred side when neither fits, but still clamps on screen", () => {
    const tall = { width: 256, height: 790 };
    const pos = placeFloating({ anchor: icon(100, 400), size: tall, viewport });
    expect(pos.side).toBe("bottom");
    expect(pos.top).toBeGreaterThanOrEqual(8);
  });

  it("pins a box wider than the viewport to the start margin", () => {
    const pos = placeFloating({ anchor: icon(100, 100), size: { width: 2000, height: 60 }, viewport: { width: 320, height: 800 } });
    expect(pos.left).toBe(8);
  });
});
