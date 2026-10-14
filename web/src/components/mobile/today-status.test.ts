import { describe, expect, it } from "vitest";
import type { DayData } from "@/components/time-tracker/types";
import { todayStatus } from "./today-status";

const day = (over: Partial<DayData> = {}): DayData => ({
  date: "2026-10-14", // a Wednesday
  start_time: "",
  stop_time: "",
  net_mins: 0,
  holiday: false,
  public_holiday: false,
  sick_leave: false,
  comp_mins: 0,
  comp_note: "",
  breaks: [],
  ...over,
});

describe("todayStatus", () => {
  it("is a blank placeholder while the week has not loaded", () => {
    expect(todayStatus(null, "2026-10-14")).toEqual({ value: "—", sub: "", tone: "default", off: false });
  });

  it("shows the hours and the span when something is logged", () => {
    const s = todayStatus(day({ net_mins: 510, start_time: "08:00", stop_time: "17:00" }), "2026-10-14");
    expect(s).toEqual({ value: "8h 30m", sub: "08:00–17:00", tone: "positive", off: false });
  });

  it("says a day paid from the overtime bank is compensated", () => {
    expect(todayStatus(day({ comp_mins: 504 }), "2026-10-14")).toEqual({ value: "Compensated", sub: "8h 24m", tone: "positive", off: true });
  });

  it("shows the compensated part next to the hours when both exist", () => {
    const s = todayStatus(day({ net_mins: 300, comp_mins: 204, start_time: "09:00", stop_time: "14:00" }), "2026-10-14");
    expect(s).toEqual({ value: "5h 00m", sub: "09:00–14:00 · 3h 24m comp", tone: "positive", off: false });
  });

  it("names the kind of day off instead of showing an empty dash", () => {
    expect(todayStatus(day({ holiday: true }), "2026-10-14")).toMatchObject({ value: "Vacation", sub: "Day off", off: true });
    expect(todayStatus(day({ public_holiday: true }), "2026-10-14")).toMatchObject({ value: "Holiday", sub: "Day off", off: true });
    expect(todayStatus(day({ sick_leave: true }), "2026-10-14")).toMatchObject({ value: "Sick", sub: "Day off", off: true });
  });

  it("calls a weekend with nothing logged a day off", () => {
    expect(todayStatus(day({ date: "2026-10-10" }), "2026-10-10")).toMatchObject({ value: "Weekend", sub: "Day off", off: true }); // Saturday
    expect(todayStatus(day({ date: "2026-10-11" }), "2026-10-11")).toMatchObject({ value: "Weekend", off: true }); // Sunday
  });

  it("still shows weekend hours when they were logged", () => {
    expect(todayStatus(day({ date: "2026-10-10", net_mins: 120, start_time: "09:00", stop_time: "11:00" }), "2026-10-10")).toMatchObject({ value: "2h 00m", off: false });
  });

  it("keeps the nudge for a weekday with nothing yet", () => {
    expect(todayStatus(day(), "2026-10-14")).toEqual({ value: "—", sub: "Not logged", tone: "default", off: false });
  });
});
