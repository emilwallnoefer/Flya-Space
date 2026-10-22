import { describe, expect, it } from "vitest";
import { DAILY_WINDOW_WORKDAYS, dailyTravel, smoothPath, teamShare } from "./field-stats-share";

describe("teamShare", () => {
  it("adds the team's days and workdays up before dividing", () => {
    const team = teamShare(
      [
        { pilot: "A", workDays: 20, pocDays: 2, trainingDays: 1, travelDays: 10 },
        { pilot: "B", workDays: 5, pocDays: 0, trainingDays: 0, travelDays: 0 },
      ],
      "travelDays",
    );
    // 10 of 25, not the average of 50% and 0%.
    expect(team).toEqual({ days: 10, workDays: 25, percent: 40 });
  });

  it("is 0% when nobody had a workday", () => {
    expect(teamShare([], "travelDays")).toEqual({ days: 0, workDays: 0, percent: 0 });
  });
});

describe("dailyTravel", () => {
  const days = [
    { date: "2026-01-05", travel: 4, home: 0 },
    { date: "2026-01-06", travel: 0, home: 4 },
    { date: "2026-01-07", travel: 2, home: 2 },
    { date: "2026-01-08", travel: 1, home: 1 },
  ];

  it("averages the pilots on the road over the last few workdays", () => {
    expect(dailyTravel(days, false, 2).map((d) => d.value)).toEqual([4, 2, 1, 1.5]);
  });

  it("in % mode, divides the window's travel by the window's workdays", () => {
    // Day 2: 4 of 8; day 3: 2 of 8; day 4: 3 of 6.
    expect(dailyTravel(days, true, 2).map((d) => d.value)).toEqual([100, 50, 25, 50]);
  });

  it("rises on a travel day and falls on a home day", () => {
    const values = dailyTravel(days, false, 1).map((d) => d.value);
    expect(values).toEqual([4, 0, 2, 1]);
  });

  it("is 0% when nobody had a workday, and empty for no days", () => {
    expect(dailyTravel([{ date: "2026-01-05", travel: 0, home: 0 }], true).map((d) => d.value)).toEqual([0]);
    expect(dailyTravel([], false)).toEqual([]);
  });

  it("keeps each day's own counts for the tooltip", () => {
    expect(dailyTravel(days, false, 2)[1]).toEqual({ date: "2026-01-06", travel: 0, home: 4, value: 2 });
  });

  it("averages two working weeks by default", () => {
    expect(DAILY_WINDOW_WORKDAYS).toBe(10);
  });
});

describe("smoothPath", () => {
  const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

  it("is empty for no points and a single move for one", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 5, y: 7 }])).toBe("M5,7");
  });

  it("runs through every point with curves", () => {
    const path = smoothPath([
      { x: 0, y: 50 },
      { x: 50, y: 10 },
      { x: 100, y: 60 },
    ]);
    expect(path.startsWith("M0,50 C")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
    expect(path).toContain("50,10 C");
    expect(path.endsWith("100,60")).toBe(true);
  });

  it("never overshoots: a flat stretch stays flat and nothing leaves the data's range", () => {
    const path = smoothPath([
      { x: 0, y: 100 },
      { x: 25, y: 100 },
      { x: 50, y: 0 },
      { x: 75, y: 0 },
      { x: 100, y: 100 },
    ]);
    const ys = numbers(path).filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(100);
    // The flat stretch between 50 and 75 is drawn flat.
    expect(path).toContain("C58.333,0 66.667,0 75,0");
  });
});
