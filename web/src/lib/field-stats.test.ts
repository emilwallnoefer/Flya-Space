import { describe, expect, it } from "vitest";
import {
  canSeeFieldStatsDetail,
  classifyDay,
  computeFieldStats,
  findPilotColumns,
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
    const bucket = { pilots: [{ pilot: "A", poc: 1, training: 0, travelDays: 1 }], regions: [] };
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
});
