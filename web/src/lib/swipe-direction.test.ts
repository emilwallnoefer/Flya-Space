import { describe, expect, it } from "vitest";
import { SWIPE_MIN_PX, swipeDirection } from "./swipe-direction";

describe("swipeDirection", () => {
  it("reads a long sideways move as a swipe", () => {
    expect(swipeDirection(-120, 10)).toBe("left");
    expect(swipeDirection(120, -10)).toBe("right");
  });

  it("ignores a short move", () => {
    expect(swipeDirection(SWIPE_MIN_PX - 1, 0)).toBeNull();
    expect(swipeDirection(-(SWIPE_MIN_PX - 1), 0)).toBeNull();
  });

  it("ignores a mostly vertical move (scrolling)", () => {
    expect(swipeDirection(80, 200)).toBeNull();
    expect(swipeDirection(-90, 70)).toBeNull();
  });

  it("accepts the threshold exactly", () => {
    expect(swipeDirection(SWIPE_MIN_PX, 0)).toBe("right");
  });
});
