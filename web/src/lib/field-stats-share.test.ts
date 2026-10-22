import { describe, expect, it } from "vitest";
import { runningBalance, teamShare } from "./field-stats-share";

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

describe("runningBalance", () => {
  it("goes up one per pilot travelling and down one per pilot at home", () => {
    expect(
      runningBalance([
        { date: "2026-01-05", travel: 3, home: 1 },
        { date: "2026-01-06", travel: 0, home: 4 },
        { date: "2026-01-07", travel: 2, home: 2 },
      ]),
    ).toEqual([
      { date: "2026-01-05", travel: 3, home: 1, balance: 2 },
      { date: "2026-01-06", travel: 0, home: 4, balance: -2 },
      { date: "2026-01-07", travel: 2, home: 2, balance: -2 },
    ]);
  });

  it("is empty for no days", () => {
    expect(runningBalance([])).toEqual([]);
  });
});
