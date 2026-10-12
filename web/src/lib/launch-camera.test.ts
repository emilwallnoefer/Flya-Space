import { describe, expect, it } from "vitest";
import {
  cameraKeyframes,
  cameraTransform,
  choreographyEnd,
  isSaneCamera,
  MOVE_MS,
  REVEAL_MS,
  revealDelay,
  transformString,
  type Rect,
} from "./launch-camera";

const overlay: Rect = { left: 300, top: 400, width: 680, height: 44 };
const header: Rect = { left: 60, top: 30, width: 170, height: 11 };

function apply(c: { s: number; tx: number; ty: number }, x: number, y: number) {
  return { x: c.s * x + c.tx, y: c.s * y + c.ty };
}

describe("cameraTransform", () => {
  it("maps the header centre exactly onto the overlay centre", () => {
    const c = cameraTransform(overlay, header);
    expect(c.s).toBe(4);
    const mapped = apply(c, 60 + 85, 30 + 5.5);
    expect(mapped.x).toBeCloseTo(300 + 340, 6);
    expect(mapped.y).toBeCloseTo(400 + 22, 6);
  });

  it("also does so for fractional rects", () => {
    const o: Rect = { left: 249.37, top: 339.2, width: 251.9, height: 15.4 };
    const h: Rect = { left: 16.5, top: 61.25, width: 184.6, height: 11.2 };
    const c = cameraTransform(o, h);
    const mapped = apply(c, h.left + h.width / 2, h.top + h.height / 2);
    expect(mapped.x).toBeCloseTo(o.left + o.width / 2, 6);
    expect(mapped.y).toBeCloseTo(o.top + o.height / 2, 6);
    expect(c.s).toBeCloseTo(251.9 / 184.6, 9);
  });
});

describe("isSaneCamera", () => {
  it("rejects degenerate and absurd cameras", () => {
    expect(isSaneCamera({ s: 1, tx: 0, ty: 0 })).toBe(false);
    expect(isSaneCamera({ s: 13, tx: 0, ty: 0 })).toBe(false);
    expect(isSaneCamera({ s: NaN, tx: 0, ty: 0 })).toBe(false);
    expect(isSaneCamera({ s: Infinity, tx: 0, ty: 0 })).toBe(false);
    expect(isSaneCamera(cameraTransform(overlay, { ...header, width: 0 }))).toBe(false);
  });
  it("accepts the desktop and phone magnitudes", () => {
    expect(isSaneCamera({ s: 4, tx: -90, ty: 125 })).toBe(true);
    expect(isSaneCamera({ s: 1.36, tx: 10, ty: 310 })).toBe(true);
  });
});

describe("cameraKeyframes", () => {
  const frames = cameraKeyframes(overlay, header, 24);
  const parse = (t: string) => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t)!;
    return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
  };

  it("starts exactly at the camera and ends exactly at identity", () => {
    expect(frames).toHaveLength(25);
    expect(frames[0].transform).toBe(transformString(cameraTransform(overlay, header)));
    expect(frames[24].transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("scales geometrically, strictly decreasing", () => {
    const scales = frames.map((f) => parse(f.transform).s);
    for (let k = 1; k < scales.length; k++) expect(scales[k]).toBeLessThan(scales[k - 1]);
    const ratios = scales.slice(0, -1).map((s, k) => s / scales[k + 1]);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 2);
  });

  it("keeps the title centre on the straight line between the two rests", () => {
    const o = { x: 640, y: 422 };
    const h = { x: 145, y: 35.5 };
    frames.forEach((f, k) => {
      const p = k / 24;
      const c = parse(f.transform);
      const mapped = apply(c, h.x, h.y);
      expect(mapped.x).toBeCloseTo(o.x + p * (h.x - o.x), 0); // 3-decimal transform strings: ±0.5 px
      expect(mapped.y).toBeCloseTo(o.y + p * (h.y - o.y), 0);
    });
  });
});

describe("reveal timing", () => {
  it("staggers from the start", () => {
    expect(revealDelay(0, 450, 70)).toBe(450);
    expect(revealDelay(8, 450, 70)).toBe(1010);
  });
  it("ends with the move or the last reveal, whichever is later", () => {
    expect(choreographyEnd(0)).toBe(MOVE_MS);
    expect(choreographyEnd(8)).toBe(revealDelay(8) + REVEAL_MS);
  });
});
