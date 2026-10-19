import { describe, expect, it } from "vitest";
import { reserveErrorMessage } from "./reserve-message";

const reliability = { score: 62, horizonDays: 56 };

describe("reserveErrorMessage", () => {
  it("explains an inverted span", () => {
    expect(reserveErrorMessage({ ok: false, reason: "inverted" }, reliability, "SVA-257")).toBe(
      "The last day cannot be before the first.",
    );
  });

  it("explains a day in the past", () => {
    expect(reserveErrorMessage({ ok: false, reason: "past" }, reliability, "SVA-257")).toBe(
      "That day is already past.",
    );
  });

  it("names the cap on a span that is too long", () => {
    expect(
      reserveErrorMessage({ ok: false, reason: "too_long", maxDays: 84 }, reliability, "SVA-257"),
    ).toContain("at most 84 days");
  });

  it("names the person's own score and horizon, not the asset's", () => {
    // The horizon comes off the CHECK (which may have used the admin override),
    // while the score comes off the reliability record — mixing the two up is
    // how this message starts quoting a number nobody can act on.
    const message = reserveErrorMessage(
      { ok: false, reason: "beyond_horizon", horizonDays: 56 },
      reliability,
      "SVA-257",
    );
    expect(message).toContain("(62)");
    expect(message).toContain("56 days ahead");
  });

  it("names the asset on a clash and points at the waitlist", () => {
    const message = reserveErrorMessage(
      { ok: false, reason: "overlap", conflicting: [] },
      reliability,
      "SVA-257",
    );
    expect(message).toContain("SVA-257");
    expect(message).toMatch(/waitlist/i);
  });

  it("names the free siblings on a clash, and still mentions the waitlist", () => {
    const one = reserveErrorMessage({ ok: false, reason: "overlap", conflicting: [] }, reliability, "SVA-257", [{ name: "SVA-330" }]);
    expect(one).toContain("SVA-330 is free for those days");
    expect(one).toMatch(/waitlist/i);
    const three = reserveErrorMessage({ ok: false, reason: "overlap", conflicting: [] }, reliability, "SVA-257", [
      { name: "A" },
      { name: "B" },
      { name: "C" },
    ]);
    expect(three).toContain("A, B and 1 more are free");
  });

  it("tells assigned twins apart from free ones", () => {
    const mixed = reserveErrorMessage({ ok: false, reason: "overlap", conflicting: [] }, reliability, "SVA-257", [
      { name: "SVA-330", assigned: false, holder: null },
      { name: "SVA-412", assigned: true, holder: "Charles" },
    ]);
    expect(mixed).toContain("SVA-330 is free for those days");
    expect(mixed).toContain("SVA-412 (Charles) is assigned and can be asked for");
    const onlyAssigned = reserveErrorMessage({ ok: false, reason: "overlap", conflicting: [] }, reliability, "SVA-257", [
      { name: "SVA-412", assigned: true, holder: null },
    ]);
    expect(onlyAssigned).toContain("SVA-412 is assigned and can be asked for");
    expect(onlyAssigned).toMatch(/waitlist/i);
  });
});
