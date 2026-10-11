import { describe, expect, it } from "vitest";
import {
  hasLoggedAnyDay,
  isReminderWindow,
  weekUnloggedPayload,
  workWeekOf,
  zurichParts,
} from "./week-unlogged";

describe("zurichParts / isReminderWindow", () => {
  it("fires at 19:xx Zurich on a Friday in summer time (17:xx UTC)", () => {
    const parts = zurichParts(new Date("2026-07-10T17:05:00Z"));
    expect(parts).toMatchObject({ weekday: "Fri", hour: 19, minute: 5, date: "2026-07-10" });
    expect(isReminderWindow(parts)).toBe(true);
  });

  it("fires at 19:xx Zurich on a Friday in winter time (18:xx UTC)", () => {
    const parts = zurichParts(new Date("2026-12-11T18:00:00Z"));
    expect(parts).toMatchObject({ weekday: "Fri", hour: 19, date: "2026-12-11" });
    expect(isReminderWindow(parts)).toBe(true);
  });

  it("the other cron slot of the same day is outside the window", () => {
    // Summer: the 18:00 UTC slot is 20:00 Zurich.
    expect(isReminderWindow(zurichParts(new Date("2026-07-10T18:00:00Z")))).toBe(false);
    // Winter: the 17:00 UTC slot is 18:00 Zurich.
    expect(isReminderWindow(zurichParts(new Date("2026-12-11T17:00:00Z")))).toBe(false);
  });

  it("never fires on another weekday", () => {
    expect(isReminderWindow(zurichParts(new Date("2026-07-09T17:00:00Z")))).toBe(false);
    expect(isReminderWindow(zurichParts(new Date("2026-07-11T17:00:00Z")))).toBe(false);
  });

  it("reports the Zurich date, not the UTC one, late in the evening", () => {
    expect(zurichParts(new Date("2026-07-10T22:30:00Z")).date).toBe("2026-07-11");
  });
});

describe("workWeekOf", () => {
  it("returns Monday to Friday for a Friday", () => {
    expect(workWeekOf("2026-10-16")).toEqual({ start: "2026-10-12", end: "2026-10-16" });
  });
  it("handles a Sunday (week ends the Friday before)", () => {
    expect(workWeekOf("2026-10-18")).toEqual({ start: "2026-10-12", end: "2026-10-16" });
  });
  it("handles a Monday and crosses a month boundary", () => {
    expect(workWeekOf("2026-11-02")).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    expect(workWeekOf("2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-02" });
  });
});

describe("hasLoggedAnyDay", () => {
  const empty = { net_mins: 0, holiday: false, public_holiday: false, sick_leave: false };

  it("is false with no rows and no comp", () => {
    expect(hasLoggedAnyDay([])).toBe(false);
  });
  it("is false when rows exist but hold nothing", () => {
    expect(hasLoggedAnyDay([empty, { ...empty, net_mins: null }])).toBe(false);
  });
  it("is true for worked minutes", () => {
    expect(hasLoggedAnyDay([empty, { ...empty, net_mins: 30 }])).toBe(true);
  });
  it("is true for a vacation, public holiday or sick day", () => {
    expect(hasLoggedAnyDay([{ ...empty, holiday: true }])).toBe(true);
    expect(hasLoggedAnyDay([{ ...empty, public_holiday: true }])).toBe(true);
    expect(hasLoggedAnyDay([{ ...empty, sick_leave: true }])).toBe(true);
  });
  it("is true when a comp adjustment was entered", () => {
    expect(hasLoggedAnyDay([], 1)).toBe(true);
  });
});

describe("weekUnloggedPayload", () => {
  it("greets by name in the title and lands on the Time module", () => {
    const payload = weekUnloggedPayload("Sam");
    expect(payload.title).toBe("Sam, log your week");
    expect(payload.url).toBe("/dashboard?module=time");
    expect(payload.tag).toBe("week_unlogged");
  });
  it("works without a name", () => {
    expect(weekUnloggedPayload(null).title).toBe("Log your week");
  });
  it("stays short enough for one lock-screen line", () => {
    expect(weekUnloggedPayload("Sam").body.length).toBeLessThanOrEqual(45);
  });
});
