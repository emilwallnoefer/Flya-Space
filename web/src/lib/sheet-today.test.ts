import { describe, expect, it } from "vitest";
import { columnLetter, findTodayColumnCell, findTodayRowCell } from "@/lib/sheet-today";

describe("columnLetter", () => {
  it("converts zero-based indexes to sheet letters", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("findTodayRowCell", () => {
  const rows = [
    ["", "", "", "Charles"],
    ["September 2026", "Wed", "30"],
    ["October 2026", "Thu", "1"],
    ["", "Fri", "2"],
    ["", "Sat", "3"],
  ];

  it("carries the month down and matches the day column", () => {
    expect(findTodayRowCell(rows, "2026-10-03")).toBe("A5");
    expect(findTodayRowCell(rows, "2026-09-30")).toBe("A2");
  });

  it("accepts a full date in column A", () => {
    expect(findTodayRowCell([["header"], ["06.10.2026"]], "2026-10-06")).toBe("A2");
  });

  it("returns null when today has no row", () => {
    expect(findTodayRowCell(rows, "2026-10-04")).toBeNull();
  });
});

describe("findTodayColumnCell", () => {
  it("carries the month right and matches the day row", () => {
    const rows = [
      ["", "January 2026", "", "", "February 2026", ""],
      ["", "1", "2", "3", "1", "2"],
      ["E3 #12", "x", "", "", "", ""],
    ];
    expect(findTodayColumnCell(rows, "2026-01-03")).toBe("D2");
    expect(findTodayColumnCell(rows, "2026-02-02")).toBe("F2");
  });

  it("finds header rows that are not at the very top", () => {
    const rows = [["Roadshow"], [], ["", "October 2026", ""], ["", "5", "6"]];
    expect(findTodayColumnCell(rows, "2026-10-06")).toBe("C4");
  });

  it("returns null when no column is today", () => {
    expect(findTodayColumnCell([["January 2024"], ["1"]], "2026-10-06")).toBeNull();
  });
});
