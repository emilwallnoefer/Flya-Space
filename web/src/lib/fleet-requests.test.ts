import { describe, expect, it } from "vitest";
import {
  classifyDateChange,
  dateChangeErrorMessage,
  requestExpired,
  requestStatusLabel,
  shortenedStartFor,
} from "./fleet-requests";

const today = "2026-09-14";
const live = { start_date: "2026-09-10", end_date: "2026-09-16", status: "picked_up" as const };

describe("classifying a change of dates", () => {
  it("knows an extension from a shortening, and a no-op from both", () => {
    expect(classifyDateChange({ span: live, newEnd: "2026-09-18", today, horizonDays: 56 })).toEqual({
      kind: "extend",
      added: { start_date: "2026-09-17", end_date: "2026-09-18" },
    });
    expect(classifyDateChange({ span: live, newEnd: "2026-09-15", today, horizonDays: 56 })).toEqual({ kind: "shorten" });
    expect(classifyDateChange({ span: live, newEnd: "2026-09-16", today, horizonDays: 56 })).toEqual({ kind: "none" });
  });

  it("starts the added stretch today when the booking is already overdue", () => {
    const overdue = { ...live, end_date: "2026-09-12" };
    expect(classifyDateChange({ span: overdue, newEnd: "2026-09-15", today, horizonDays: 56 })).toEqual({
      kind: "extend",
      added: { start_date: today, end_date: "2026-09-15" },
    });
  });

  it("refuses the last day before the first, before today, or on a closed booking", () => {
    expect(classifyDateChange({ span: live, newEnd: "2026-09-09", today, horizonDays: 56 })).toMatchObject({
      kind: "invalid",
      reason: "before_start",
    });
    expect(classifyDateChange({ span: live, newEnd: "2026-09-13", today, horizonDays: 56 })).toMatchObject({
      kind: "invalid",
      reason: "in_past",
    });
    // An overdue booking cannot be shortened — it can only be checked in.
    expect(classifyDateChange({ span: { ...live, end_date: "2026-09-12" }, newEnd: "2026-09-11", today, horizonDays: 56 })).toMatchObject({
      kind: "invalid",
      reason: "in_past",
    });
    expect(
      classifyDateChange({ span: { ...live, status: "returned" }, newEnd: "2026-09-18", today, horizonDays: 56 }),
    ).toMatchObject({ kind: "invalid", reason: "not_live" });
  });

  it("bounds an extension by the maximum length and by the horizon to the NEW end", () => {
    // 2026-09-10 + 83 days = 2026-12-02 is the longest allowed last day.
    expect(classifyDateChange({ span: live, newEnd: "2026-12-02", today, horizonDays: 365 }).kind).toBe("extend");
    expect(classifyDateChange({ span: live, newEnd: "2026-12-03", today, horizonDays: 365 })).toMatchObject({
      kind: "invalid",
      reason: "too_long",
      maxDays: 84,
    });
    // Provisional score: 56 days ahead. 2026-09-14 + 56 = 2026-11-09.
    expect(classifyDateChange({ span: live, newEnd: "2026-11-09", today, horizonDays: 56 }).kind).toBe("extend");
    expect(classifyDateChange({ span: live, newEnd: "2026-11-10", today, horizonDays: 56 })).toMatchObject({
      kind: "invalid",
      reason: "beyond_horizon",
      horizonDays: 56,
    });
  });

  it("explains every refusal in one sentence that names the number", () => {
    expect(dateChangeErrorMessage({ kind: "none" }, 75)).toMatch(/already/);
    expect(dateChangeErrorMessage({ kind: "invalid", reason: "too_long", maxDays: 84 }, 75)).toContain("84");
    expect(dateChangeErrorMessage({ kind: "invalid", reason: "beyond_horizon", horizonDays: 56 }, 75)).toContain("(75)");
    expect(dateChangeErrorMessage({ kind: "invalid", reason: "in_past" }, 75)).toMatch(/check it in/i);
  });
});

describe("answering an extension request", () => {
  it("moves the next booking's start to the day after the requested end", () => {
    expect(shortenedStartFor({ end_date: "2026-09-25" }, "2026-09-20")).toBe("2026-09-21");
  });

  it("has nothing left to shorten when the extension swallows the whole booking", () => {
    expect(shortenedStartFor({ end_date: "2026-09-20" }, "2026-09-20")).toBeNull();
    expect(shortenedStartFor({ end_date: "2026-09-19" }, "2026-09-20")).toBeNull();
  });

  it("lapses once the next booking's first day has arrived", () => {
    expect(requestExpired({ start_date: "2026-09-15" }, today)).toBe(false);
    expect(requestExpired({ start_date: today }, today)).toBe(true);
    expect(requestExpired({ start_date: "2026-09-01" }, today)).toBe(true);
  });

  it("labels every outcome", () => {
    expect(requestStatusLabel("pending", null)).toMatch(/waiting/i);
    expect(requestStatusLabel("accepted", "shorten")).toMatch(/start later/i);
    expect(requestStatusLabel("accepted", "cancel")).toMatch(/cancelled/i);
    expect(requestStatusLabel("declined", null)).toMatch(/declined/i);
    expect(requestStatusLabel("expired", null)).toBe("Lapsed");
    expect(requestStatusLabel("cancelled", null)).toBe("Withdrawn");
  });
});
