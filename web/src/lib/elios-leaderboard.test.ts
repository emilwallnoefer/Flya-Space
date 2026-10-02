import { describe, expect, it } from "vitest";
import {
  ELIOS_RULES_VERSION,
  LEADERBOARD_LIMIT,
  MAX_PLAUSIBLE_SCORE,
  firstNameOf,
  isCurrentRules,
  parseSubmittedScore,
  rankBoard,
  shouldRecord,
} from "@/lib/elios-leaderboard";

describe("firstNameOf", () => {
  it("takes the first name only", () => {
    expect(firstNameOf("Emil Wallnöfer")).toBe("Emil");
    expect(firstNameOf("Tiago Leconte Pais")).toBe("Tiago");
    expect(firstNameOf("Emil")).toBe("Emil");
  });

  it("copes with the shapes displayNameFor can produce", () => {
    expect(firstNameOf("  Emil  Wallnofer ")).toBe("Emil");
    expect(firstNameOf("")).toBe("Someone");
    expect(firstNameOf("   ")).toBe("Someone");
  });

  it("truncates something absurd rather than stretching the board", () => {
    const out = firstNameOf("A".repeat(60));
    expect(out.length).toBeLessThanOrEqual(18);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("parseSubmittedScore", () => {
  it("accepts a real score", () => {
    expect(parseSubmittedScore(7)).toBe(7);
    expect(parseSubmittedScore(7.4)).toBe(7);
  });

  it("rejects anything that is not a plausible score", () => {
    // Everything here arrives from a browser we do not control.
    for (const raw of [0, -3, Number.NaN, Infinity, "5", null, undefined, {}, [], true]) {
      expect(parseSubmittedScore(raw)).toBeNull();
    }
  });

  it("rejects a joke submission above the cap", () => {
    expect(parseSubmittedScore(MAX_PLAUSIBLE_SCORE)).toBe(MAX_PLAUSIBLE_SCORE);
    expect(parseSubmittedScore(MAX_PLAUSIBLE_SCORE + 1)).toBeNull();
    expect(parseSubmittedScore(1e9)).toBeNull();
  });
});

describe("shouldRecord", () => {
  it("records a first score", () => {
    expect(shouldRecord(3, null)).toBe(true);
  });

  it("only records an improvement, so a bad run cannot overwrite a good one", () => {
    expect(shouldRecord(9, 4)).toBe(true);
    expect(shouldRecord(4, 9)).toBe(false);
    expect(shouldRecord(4, 4)).toBe(false);
  });

  it("refuses a score that is not a plausible integer", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, MAX_PLAUSIBLE_SCORE + 1]) {
      expect(shouldRecord(bad, null)).toBe(false);
    }
  });
});

describe("rankBoard", () => {
  const rows = [
    { userId: "a", name: "Emil Wallnofer", score: 5, achievedAt: "2026-09-15T10:00:00Z" },
    { userId: "b", name: "Charles Rey", score: 12, achievedAt: "2026-09-15T09:00:00Z" },
    { userId: "c", name: "Igor Stapper", score: 12, achievedAt: "2026-09-15T08:00:00Z" },
  ];

  it("puts the highest score first", () => {
    expect(rankBoard(rows, null).map((r) => r.score)).toEqual([12, 12, 5]);
  });

  it("breaks a tie by who got there first, so the order is stable", () => {
    const names = rankBoard(rows, null).map((r) => r.name);
    expect(names).toEqual(["Igor", "Charles", "Emil"]);
    // Same input, same output — no shuffling between reads.
    expect(rankBoard(rows, null)).toEqual(rankBoard([...rows].reverse(), null));
  });

  it("shows first names only", () => {
    expect(rankBoard(rows, null).every((r) => !r.name.includes(" "))).toBe(true);
  });

  it("marks the viewer's own row and nobody else's", () => {
    const board = rankBoard(rows, "a");
    expect(board.filter((r) => r.you)).toHaveLength(1);
    expect(board.find((r) => r.you)?.name).toBe("Emil");
  });

  it("marks nothing when signed out", () => {
    expect(rankBoard(rows, null).some((r) => r.you)).toBe(false);
  });

  it("caps the board length", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      userId: `u${i}`,
      name: `Person${i}`,
      score: i + 1,
      achievedAt: "2026-09-15T10:00:00Z",
    }));
    expect(rankBoard(many, null)).toHaveLength(LEADERBOARD_LIMIT);
    expect(rankBoard(many, null, 3)).toHaveLength(3);
  });

  it("does not mutate the rows it was given", () => {
    const original = [...rows];
    rankBoard(rows, "a");
    expect(rows).toEqual(original);
  });
});

describe("isCurrentRules", () => {
  it("accepts only the rules the board is counting", () => {
    expect(isCurrentRules(ELIOS_RULES_VERSION)).toBe(true);
    expect(isCurrentRules(ELIOS_RULES_VERSION - 1)).toBe(false);
    expect(isCurrentRules(ELIOS_RULES_VERSION + 1)).toBe(false);
  });

  it("refuses a submission with no version — what a tab on the previous build sends", () => {
    expect(isCurrentRules(undefined)).toBe(false);
    expect(isCurrentRules(null)).toBe(false);
    expect(isCurrentRules(String(ELIOS_RULES_VERSION))).toBe(false);
  });
});
