import { describe, expect, it } from "vitest";
import {
  QUARTER_HOURS,
  joinTime,
  nearestQuarterHour,
  padSegment,
  splitTime,
  stepSegment,
  typeDigit,
  type Segment,
} from "./time-field-parse";

/** Types a string of digits into one box, starting fresh. */
function typeAll(segment: Segment, digits: string) {
  let text = "";
  let fresh = true;
  let done = false;
  for (const d of digits) {
    ({ text, done } = typeDigit(segment, text, fresh, Number(d)));
    fresh = done;
  }
  return { text, done };
}

describe("splitTime / joinTime", () => {
  it("round-trips stored times", () => {
    expect(splitTime("07:30")).toEqual({ h: "07", m: "30" });
    expect(joinTime("07", "30")).toBe("07:30");
  });

  it("treats anything else as empty", () => {
    expect(splitTime("")).toEqual({ h: "", m: "" });
    expect(splitTime("7:30")).toEqual({ h: "", m: "" });
    expect(splitTime("25:00")).toEqual({ h: "", m: "" });
  });

  it("pads single digits", () => {
    expect(joinTime("7", "5")).toBe("07:05");
  });

  it("is empty when both boxes are, and nothing when only one is", () => {
    expect(joinTime("", "")).toBe("");
    expect(joinTime("07", "")).toBeNull();
    expect(joinTime("", "30")).toBeNull();
  });
});

describe("typeDigit", () => {
  it("takes two digits for the hour, then moves on", () => {
    expect(typeAll("h", "1")).toEqual({ text: "1", done: false });
    expect(typeAll("h", "12")).toEqual({ text: "12", done: true });
    expect(typeAll("h", "07")).toEqual({ text: "07", done: true });
    expect(typeAll("h", "23")).toEqual({ text: "23", done: true });
  });

  it("moves on at once when the first digit can't start a two-digit hour", () => {
    expect(typeAll("h", "7")).toEqual({ text: "07", done: true });
    expect(typeAll("h", "3")).toEqual({ text: "03", done: true });
  });

  it("starts over when the second digit would make an impossible hour", () => {
    expect(typeAll("h", "25")).toEqual({ text: "05", done: true });
    expect(typeAll("h", "24")).toEqual({ text: "04", done: true });
  });

  it("works the same for minutes, up to 59", () => {
    expect(typeAll("m", "30")).toEqual({ text: "30", done: true });
    expect(typeAll("m", "5")).toEqual({ text: "5", done: false });
    expect(typeAll("m", "59")).toEqual({ text: "59", done: true });
    expect(typeAll("m", "7")).toEqual({ text: "07", done: true });
  });

  it("replaces a complete box instead of appending", () => {
    expect(typeDigit("h", "12", false, 9)).toEqual({ text: "09", done: true });
    expect(typeDigit("h", "1", true, 9)).toEqual({ text: "09", done: true });
  });
});

describe("stepSegment", () => {
  it("steps and wraps", () => {
    expect(stepSegment("h", "07", 1)).toBe("08");
    expect(stepSegment("h", "23", 1)).toBe("00");
    expect(stepSegment("h", "00", -1)).toBe("23");
    expect(stepSegment("m", "59", 1)).toBe("00");
    expect(stepSegment("m", "00", -1)).toBe("59");
  });

  it("starts an empty box somewhere sensible", () => {
    expect(stepSegment("h", "", 1)).toBe("08");
    expect(stepSegment("m", "", -1)).toBe("00");
  });
});

describe("padSegment", () => {
  it("pads a half-typed box when it is left", () => {
    expect(padSegment("1")).toBe("01");
    expect(padSegment("")).toBe("");
  });
});

describe("picker list", () => {
  it("has every quarter hour from 00:00 to 23:45", () => {
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(QUARTER_HOURS[0]).toBe("00:00");
    expect(QUARTER_HOURS[95]).toBe("23:45");
  });

  it("finds the row to scroll to", () => {
    expect(nearestQuarterHour("07:30")).toBe("07:30");
    expect(nearestQuarterHour("07:44")).toBe("07:30");
    expect(nearestQuarterHour("")).toBe("08:00");
  });
});
