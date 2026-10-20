import { describe, expect, it } from "vitest";
import {
  QUARTER_HOURS,
  nearestQuarterHour,
  parseTimeLive,
  parseTimeOnBlur,
  sanitizeTimeDraft,
  stepTime,
} from "./time-field-parse";

describe("sanitizeTimeDraft", () => {
  it("keeps digits and a single colon, max five characters", () => {
    expect(sanitizeTimeDraft("07:30")).toBe("07:30");
    expect(sanitizeTimeDraft("7:3:0")).toBe("7:30");
    expect(sanitizeTimeDraft("07:30 PM")).toBe("07:30");
    expect(sanitizeTimeDraft("123456")).toBe("12345");
  });

  it("treats a dot or an h as the separator", () => {
    expect(sanitizeTimeDraft("7.30")).toBe("7:30");
    expect(sanitizeTimeDraft("7h30")).toBe("7:30");
  });

  it("drops a leading separator", () => {
    expect(sanitizeTimeDraft(":30")).toBe("30");
  });
});

describe("parseTimeLive", () => {
  it("accepts complete times", () => {
    expect(parseTimeLive("07:30")).toBe("07:30");
    expect(parseTimeLive("7:30")).toBe("07:30");
    expect(parseTimeLive("0730")).toBe("07:30");
    expect(parseTimeLive("19:05")).toBe("19:05");
    expect(parseTimeLive("00:00")).toBe("00:00");
    expect(parseTimeLive("23:59")).toBe("23:59");
  });

  it("waits on drafts that could still grow", () => {
    expect(parseTimeLive("")).toBeNull();
    expect(parseTimeLive("7")).toBeNull();
    expect(parseTimeLive("73")).toBeNull();
    expect(parseTimeLive("730")).toBeNull();
    expect(parseTimeLive("7:3")).toBeNull();
  });

  it("rejects impossible times", () => {
    expect(parseTimeLive("24:00")).toBeNull();
    expect(parseTimeLive("12:60")).toBeNull();
    expect(parseTimeLive("2460")).toBeNull();
  });
});

describe("parseTimeOnBlur", () => {
  it("fills in what a person obviously meant", () => {
    expect(parseTimeOnBlur("7")).toBe("07:00");
    expect(parseTimeOnBlur("17")).toBe("17:00");
    expect(parseTimeOnBlur("7:")).toBe("07:00");
    expect(parseTimeOnBlur("730")).toBe("07:30");
    expect(parseTimeOnBlur("7:3")).toBe("07:30");
    expect(parseTimeOnBlur("12:30")).toBe("12:30");
  });

  it("returns null for nonsense so the field can revert", () => {
    expect(parseTimeOnBlur("")).toBeNull();
    expect(parseTimeOnBlur("25")).toBeNull();
    expect(parseTimeOnBlur("990")).toBeNull();
    expect(parseTimeOnBlur("12345")).toBeNull();
  });
});

describe("stepTime", () => {
  it("moves by the given minutes", () => {
    expect(stepTime("07:30", 15)).toBe("07:45");
    expect(stepTime("07:30", -15)).toBe("07:15");
  });

  it("wraps around midnight", () => {
    expect(stepTime("23:50", 15)).toBe("00:05");
    expect(stepTime("00:05", -15)).toBe("23:50");
  });

  it("starts from the fallback when empty", () => {
    expect(stepTime("", 15)).toBe("08:15");
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
