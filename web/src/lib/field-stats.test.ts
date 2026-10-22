import { describe, expect, it } from "vitest";
import {
  canSeeFieldStatsDetail,
  classifyDay,
  computeFieldStats,
  findPilotColumns,
  isOffRed,
  NOT_FIELD_PILOTS,
  offCellKey,
  PILOT_FIRST_DAYS,
  regionFor,
  salesNameFrom,
  sameBooking,
  UNASSIGNED_REGION,
  withoutDetail,
  type FieldStats,
} from "./field-stats";

describe("field stats detail by role", () => {
  it("shows the entries to pilots and admins only", () => {
    expect(canSeeFieldStatsDetail("eu_pilot", false)).toBe(true);
    expect(canSeeFieldStatsDetail("us_pilot", false)).toBe(true);
    expect(canSeeFieldStatsDetail(null, true)).toBe(true);
    expect(canSeeFieldStatsDetail("sales", false)).toBe(false);
    expect(canSeeFieldStatsDetail("hr", false)).toBe(false);
    expect(canSeeFieldStatsDetail(null, false)).toBe(false);
  });

  it("strips every sheet text but keeps the counts", () => {
    const bucket = { pilots: [{ pilot: "A", poc: 1, training: 0, travelDays: 1 }], regions: [], workdays: [] };
    const stats: FieldStats = {
      from: "2026-01-01",
      to: "2026-01-31",
      months: ["2026-01"],
      all: bucket,
      byMonth: { "2026-01": bucket },
      events: [
        { pilot: "A", kind: "poc", start: "2026-01-05", end: "2026-01-05", days: 1, title: "Acme POC", salesName: "S", region: "R" },
      ],
      travel: [{ pilot: "A", date: "2026-01-06", activity: "Doctor appointment", status: "out of office" }],
      salesNames: ["S"],
      days: [],
    };
    const stripped = withoutDetail(stats);
    expect(stripped.events).toEqual([]);
    expect(stripped.travel).toEqual([]);
    expect(stripped.salesNames).toEqual([]);
    expect(stripped.all).toEqual(bucket);
    expect(JSON.stringify(stripped)).not.toMatch(/Acme|Doctor/);
  });
});

// Row 1 of the real "Mission planning" tab (A…AH), verbatim.
const HEADER = [
  "", "W", "D", "D", "", "",
  "CHARLES", "Status", "Deadline  + sales name",
  "Andrei", "Status", "Deadline  + sales name",
  "Philipp", "Status / Location", "Reporting to", "Logged on Sheet?",
  "Emil", "Status / Location", "Reporting to", "Logged on Sheet?",
  "Tiago", "Status / Location", "Reporting to", "Logged on Sheet?",
  "Matteo", "Status / Location", "Reporting to", "", "", "",
  "Mike", "Status",
  "Sam", "Status",
];

const EMIL = 16;

/** A sheet row: month/year in A (only on the first row of a month, as merged), day in C, Emil's trio. */
function row(monthYear: string, day: number, activity = "", status = "", reporting = ""): string[] {
  const r = Array<string>(HEADER.length).fill("");
  r[0] = monthYear;
  r[2] = String(day);
  r[EMIL] = activity;
  r[EMIL + 1] = status;
  r[EMIL + 2] = reporting;
  return r;
}

describe("findPilotColumns", () => {
  it("finds every pilot across the three column layouts", () => {
    const pilots = findPilotColumns(HEADER);
    expect(pilots.map((p) => p.name)).toEqual([
      "Charles", "Andrei", "Philipp", "Emil", "Tiago", "Matteo", "Mike", "Sam",
    ]);
    expect(pilots.find((p) => p.name === "Charles")).toEqual({ name: "Charles", activity: 6, status: 7, reporting: 8 });
    expect(pilots.find((p) => p.name === "Emil")).toEqual({ name: "Emil", activity: 16, status: 17, reporting: 18 });
    expect(pilots.find((p) => p.name === "Mike")?.reporting).toBeNull();
  });
});

describe("classifyDay", () => {
  it.each([
    ["Tronder Energie POC", "booked out of the office", { kind: "poc", travel: true }],
    ["Vigier Cement Inspection POC", "", { kind: "poc", travel: true }],
    ["Customer demo", "booked in Lausanne", { kind: "poc", travel: false }],
    ["Kiwa Latvia Intro + UT Training", "", { kind: "training", travel: true }],
    ["Apave Training", "booked in the office", { kind: "training", travel: false }],
    ["travel to Tronder Energie", "travel time", { kind: "other", travel: true }],
    ["Team Building Pilots", "booked in Lausanne", { kind: "other", travel: false }],
    ["Wincan 1hr", "", { kind: "other", travel: false }],
  ] as const)("%s / %s", (activity, status, expected) => {
    expect(classifyDay(activity, status)).toEqual(expected);
  });

  it.each([
    ["", ""],
    ["NOT AVAILABLE", ""],
    ["Blocked", ""],
    ["Blocker", ""],
    ["OFF", ""],
    ["TBC Apave Training (confirm till 15.10)", "pre booked (hold for 5 days then release)"],
    ["Kiwa POC", "pre booked (hold for 5 days then release)"],
    ["POC cancelled", ""],
  ])("does not count %j / %j", (activity, status) => {
    expect(classifyDay(activity, status).kind).toBeNull();
  });
});

describe("salesNameFrom / regionFor", () => {
  it("extracts the salesperson from both reporting layouts", () => {
    expect(salesNameFrom("Camilla")).toBe("Camilla");
    expect(salesNameFrom("15.10 igor")).toBe("Igor");
    expect(salesNameFrom("Deadline 12/11 - Camilla")).toBe("Camilla");
    expect(salesNameFrom("Camilla / Igor")).toBe("Camilla");
    expect(salesNameFrom("")).toBe("");
  });

  it("maps case-insensitively and falls back to the name", () => {
    const map = { camilla: "Nordics", Igor: "DACH" };
    expect(regionFor("Camilla", map)).toBe("Nordics");
    expect(regionFor("Igor", map)).toBe("DACH");
    expect(regionFor("Paolo", map)).toBe("Paolo");
    expect(regionFor("", map)).toBe(UNASSIGNED_REGION);
  });
});

describe("computeFieldStats", () => {
  const rows = [
    row("TODAY", NaN),
    row("December 2025", 31, "Old POC", "booked out of the office", "Camilla"),
    row("January 2026", 5, "travel to Tronder Energie", "travel time"),
    row("", 6, "Tronder Energie POC", "booked out of the office", "Camilla"),
    row("", 7, "Tronder Energie POC", "booked out of the office", "Camilla"),
    row("", 8, "travel to Tronder Energie", "travel time"),
    // Fri + Mon of one training across a weekend: one event.
    row("", 16, "Apave Training", "", "Igor"),
    row("", 19, "Apave Training", "", "Igor"),
    row("", 20, "NOT AVAILABLE"),
    row("February 2026", 2, "Kiwa POC", "", ""),
    row("", 3, "TBC Vigier POC", "pre booked (hold)", "Igor"),
    // After `today`: ignored.
    row("", 10, "Future POC", "", "Igor"),
  ];

  const stats = computeFieldStats({
    header: HEADER,
    rows,
    today: "2026-02-05",
    salesRegions: { Camilla: "Nordics" },
  });

  it("counts events, travel days, and regions from 2026 through today", () => {
    expect(stats.months).toEqual(["2026-01", "2026-02"]);
    const emil = stats.all.pilots.find((p) => p.pilot === "Emil")!;
    expect(emil).toEqual({ pilot: "Emil", poc: 2, training: 1, travelDays: 7 });
    expect(stats.all.regions).toEqual([
      { region: "Igor", events: 1, poc: 0, training: 1 },
      { region: "Nordics", events: 1, poc: 1, training: 0 },
      { region: UNASSIGNED_REGION, events: 1, poc: 1, training: 0 },
    ]);
    expect(stats.salesNames).toEqual(["Camilla", "Igor"]);
  });

  it("buckets by the month an event starts in", () => {
    expect(stats.byMonth["2026-01"].pilots.find((p) => p.pilot === "Emil")).toEqual({
      pilot: "Emil", poc: 1, training: 1, travelDays: 6,
    });
    expect(stats.byMonth["2026-02"].pilots.find((p) => p.pilot === "Emil")).toEqual({
      pilot: "Emil", poc: 1, training: 0, travelDays: 1,
    });
    expect(stats.all.pilots.find((p) => p.pilot === "Sam")).toEqual({ pilot: "Sam", poc: 0, training: 0, travelDays: 0 });
  });

  it("lists the events and travel days behind every count", () => {
    expect(stats.events).toEqual([
      {
        pilot: "Emil", kind: "poc", start: "2026-01-06", end: "2026-01-07", days: 2,
        title: "Tronder Energie POC", salesName: "Camilla", region: "Nordics",
      },
      {
        pilot: "Emil", kind: "training", start: "2026-01-16", end: "2026-01-19", days: 2,
        title: "Apave Training", salesName: "Igor", region: "Igor",
      },
      {
        pilot: "Emil", kind: "poc", start: "2026-02-02", end: "2026-02-02", days: 1,
        title: "Kiwa POC", salesName: "", region: UNASSIGNED_REGION,
      },
    ]);
    expect(stats.travel.map((d) => d.date)).toEqual([
      "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-16", "2026-01-19", "2026-02-02",
    ]);
    expect(stats.travel[0]).toEqual({
      pilot: "Emil", date: "2026-01-05", activity: "travel to Tronder Energie", status: "travel time",
    });
  });

  it("counts one training when the course changes but the customer does not", () => {
    // Verbatim from the sheet: travel, three Tesla training days, travel.
    const tesla = computeFieldStats({
      header: HEADER,
      rows: [
        row("March 2026", 9, "travel", "travel time"),
        row("", 10, "Intro Training Tesla (learn from Emil)", "booked out of the office", "Igor"),
        row("", 11, "AIIM Training Tesla (learn from Emil)", "booked out of the office", "Igor"),
        row("", 12, "AIIM Training Tesla (learn from Emil)", "booked out of the office", "Igor"),
        row("", 13, "travel", "travel time"),
      ],
      today: "2026-03-31",
    });
    expect(tesla.events).toEqual([
      {
        pilot: "Emil", kind: "training", start: "2026-03-10", end: "2026-03-12", days: 3,
        title: "Intro Training Tesla (learn from Emil)", salesName: "Igor", region: "Igor",
      },
    ]);
    expect(tesla.all.pilots.find((p) => p.pilot === "Emil")).toEqual({
      pilot: "Emil", poc: 0, training: 1, travelDays: 5,
    });
  });

  it("starts a new event for back-to-back bookings of different customers", () => {
    const two = computeFieldStats({
      header: HEADER,
      rows: [row("March 2026", 10, "Intro Training Tesla"), row("", 11, "UT Training Kiwa Latvia")],
      today: "2026-03-31",
    });
    expect(two.all.pilots.find((p) => p.pilot === "Emil")?.training).toBe(2);
  });

  it.each([
    ["Intro Training Tesla (learn from Emil)", "AIIM Training Tesla (learn from Emil)", true],
    ["Kiwa Latvia Intro + UT Training", "Kiwa Latvia AIIM Training", true],
    ["Tronder Energie POC", "Tronder Energie POC day 2", true],
    ["Intro Training Tesla", "Intro Training Apave", false],
    // A shared note in brackets is not a shared customer.
    ["Training Tesla (learn from Emil)", "Training Apave (learn from Emil)", false],
    // No customer named on either day: only identical text merges.
    ["Intro Training", "AIIM Training", false],
    ["Intro Training", "Intro Training", true],
  ])("sameBooking(%j, %j) is %s", (a, b, expected) => {
    expect(sameBooking(a, b)).toBe(expected);
  });

  it("counts up to yesterday: today and later are plans, not done", () => {
    const boundary = computeFieldStats({
      header: HEADER,
      rows: [
        row("March 2026", 18, "Kiwa POC", "booked out of the office"),
        row("", 19, "Apave Training", "booked out of the office"),
        row("", 20, "Vigier POC", "booked out of the office"),
      ],
      today: "2026-03-19",
    });
    expect(boundary.events.map((e) => e.title)).toEqual(["Kiwa POC"]);
    expect(boundary.travel.map((d) => d.date)).toEqual(["2026-03-18"]);
  });

  it("starts a new event when the same text recurs after a long gap", () => {
    const again = computeFieldStats({
      header: HEADER,
      rows: [row("March 2026", 2, "Kiwa POC"), row("", 20, "Kiwa POC")],
      today: "2026-03-31",
    });
    expect(again.all.pilots.find((p) => p.pilot === "Emil")?.poc).toBe(2);
  });

  it("leaves out the columns that are not field pilots: Charles, Matteo, Marketing", () => {
    const header = [...HEADER, "MARKETING", "Status"];
    const r = row("January 2026", 5, "Kiwa POC", "booked out of the office", "Igor");
    r[6] = "Vigier POC"; // Charles
    r[24] = "Apave Training"; // Matteo
    r.push("Trade show POC", "out of the office"); // Marketing
    const stats = computeFieldStats({ header, rows: [r], today: "2026-01-06" });
    const names = stats.all.pilots.map((p) => p.pilot);
    expect(names).not.toContain("Charles");
    expect(names).not.toContain("Matteo");
    expect(names).not.toContain("Marketing");
    expect(names).toContain("Emil");
    expect(stats.all.workdays.map((w) => w.pilot)).toEqual(names);
    expect(stats.events.map((e) => e.title)).toEqual(["Kiwa POC"]);
    expect(stats.all.regions).toEqual([{ region: "Igor", events: 1, poc: 1, training: 0 }]);
    expect(NOT_FIELD_PILOTS).toEqual(["Charles", "Matteo", "Marketing"]);
  });
});

describe("workdays", () => {
  const rows = [
    row("January 2026", 5, "travel to Tronder Energie", "travel time"),
    row("", 6, "Tronder Energie POC", "booked out of the office"),
    row("", 7, "Bank holiday"),
    row("", 10, "travel home", "travel time"), // a Saturday
    row("", 12, ""), // red with nothing written: off
    row("", 13, "Apave Training", "booked in Lausanne"),
  ];
  const emil = (stats: FieldStats, month?: string) =>
    (month ? stats.byMonth[month] : stats.all).workdays.find((w) => w.pilot === "Emil");

  it("counts weekdays minus the red cells, and only workdays in the shares", () => {
    const stats = computeFieldStats({
      header: HEADER,
      rows,
      today: "2026-02-03",
      offCells: new Set([offCellKey(2, EMIL), offCellKey(3, EMIL), offCellKey(4, EMIL)]),
    });
    // January has 22 weekdays; the 7th and 12th are red (the red Saturday was no workday anyway).
    expect(emil(stats, "2026-01")).toEqual({ pilot: "Emil", workDays: 20, pocDays: 1, trainingDays: 1, travelDays: 2 });
    // February adds Monday the 2nd.
    expect(emil(stats)).toEqual({ pilot: "Emil", workDays: 21, pocDays: 1, trainingDays: 1, travelDays: 2 });
    // The counts are unchanged: the Saturday still counts as a travel day there.
    expect(stats.all.pilots.find((p) => p.pilot === "Emil")?.travelDays).toBe(3);
  });

  it("does not count a red day's work against the workdays", () => {
    const stats = computeFieldStats({
      header: HEADER,
      rows,
      today: "2026-02-01",
      offCells: new Set([offCellKey(1, EMIL)]),
    });
    expect(emil(stats)).toMatchObject({ workDays: 21, pocDays: 0, travelDays: 1 });
  });

  it("falls back to the cell text when the colours are unknown", () => {
    const stats = computeFieldStats({ header: HEADER, rows, today: "2026-02-01" });
    // Only "Bank holiday" reads as off; the empty red cell cannot be seen.
    expect(emil(stats)).toMatchObject({ workDays: 21 });
  });

  it("starts a late joiner's workdays on their first day", () => {
    const stats = computeFieldStats({ header: HEADER, rows, today: "2026-02-01", firstDays: { Emil: "2026-01-13" } });
    expect(emil(stats, "2026-01")).toEqual({ pilot: "Emil", workDays: 14, pocDays: 0, trainingDays: 1, travelDays: 0 });
    expect(stats.all.workdays.find((w) => w.pilot === "Philipp")?.workDays).toBe(22);
  });

  it("counts, per weekday, the pilots travelling and the pilots at home", () => {
    const stats = computeFieldStats({
      header: HEADER,
      rows,
      today: "2026-02-03",
      offCells: new Set([offCellKey(2, EMIL), offCellKey(3, EMIL), offCellKey(4, EMIL)]),
    });
    // Andrei, Philipp, Emil, Mike, Sam are on (Tiago starts in May; Charles and Matteo are not field pilots).
    const day = (date: string) => stats.days.find((d) => d.date === date);
    expect(day("2026-01-05")).toEqual({ date: "2026-01-05", travel: 1, home: 4 });
    expect(day("2026-01-06")).toEqual({ date: "2026-01-06", travel: 1, home: 4 });
    expect(day("2026-01-07")).toEqual({ date: "2026-01-07", travel: 0, home: 4 }); // Emil red: off
    expect(day("2026-01-13")).toEqual({ date: "2026-01-13", travel: 0, home: 5 }); // training in Lausanne
    expect(day("2026-01-10")).toBeUndefined(); // Saturday
    expect(stats.days).toHaveLength(23); // 22 weekdays in January + 2 February
    expect(stats.days.at(-1)?.date).toBe("2026-02-02");
    // Counts only: nothing from a cell's text, so sales and HR keep it.
    expect(withoutDetail(stats).days).toEqual(stats.days);
  });

  it("starts Tiago on 4 May 2026", () => {
    expect(PILOT_FIRST_DAYS.Tiago).toBe("2026-05-04");
  });

  it.each([
    [{ red: 1 }, true],
    [{ red: 1, green: 0, blue: 0 }, true],
    [{ red: 0.8, green: 0.1, blue: 0.1 }, true],
    [{ red: 1, green: 0.85, blue: 0.6 }, false], // travel beige
    [{ red: 1, green: 1 }, false], // yellow
    [{ red: 1, blue: 1 }, false], // magenta
    [{ red: 1, green: 1, blue: 1 }, false],
    [undefined, false],
  ])("isOffRed(%j) is %s", (color, expected) => {
    expect(isOffRed(color)).toBe(expected);
  });
});
