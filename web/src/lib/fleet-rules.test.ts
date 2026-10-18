import { describe, expect, it } from "vitest";
import {
  addDays,
  assignHolderColors,
  blockedUntil,
  calendarLayerFor,
  checkReservation,
  closureStatusFor,
  computeReliability,
  dayRange,
  daysBetween,
  daysOverdue,
  describeDays,
  expiryFor,
  freeSiblings,
  normalizeKindKey,
  NO_SHOW_PENALTY,
  NO_SHOW_PENALTY_CAP,
  OVERDUE_REMINDER_DAYS,
  dueDateOf,
  dueLabel,
  formatDay,
  formatDayLong,
  formatSpan,
  formatWeekday,
  holderColorIndex,
  HOLDER_COLORS,
  holderLabelMatchesPerson,
  holderRgb,
  isBlocking,
  isBookable,
  isWeekend,
  isoWeekNumber,
  lateDays,
  monthBands,
  mondayOf,
  nameTokens,
  normalizeHolderLabel,
  occupiedUntil,
  orderQueue,
  parseDateKey,
  PROVISIONAL_SCORE,
  reminderFor,
  spanLength,
  spansOverlap,
  tierFor,
  weekdayIndex,
  type ReservationSpan,
  type SiblingAsset,
} from "./fleet-rules";

function span(partial: Partial<ReservationSpan> & { start_date: string; end_date: string }): ReservationSpan {
  return {
    id: partial.id ?? "r1",
    asset_id: partial.asset_id ?? "a1",
    user_id: partial.user_id ?? "u1",
    status: partial.status ?? "reserved",
    returned_on: partial.returned_on ?? null,
    holder_label: partial.holder_label ?? null,
    source: partial.source,
    closed_reason: partial.closed_reason ?? null,
    start_date: partial.start_date,
    end_date: partial.end_date,
  };
}

describe("date math", () => {
  it("steps days across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-08-31", "2026-09-07")).toBe(7);
    expect(daysBetween("2026-09-07", "2026-08-31")).toBe(-7);
  });

  it("counts an inclusive span, so a single day is 1", () => {
    expect(spanLength("2026-09-01", "2026-09-01")).toBe(1);
    expect(spanLength("2026-09-01", "2026-09-03")).toBe(3);
  });

  it("survives a DST transition (Europe/Zurich clocks change 2026-10-25)", () => {
    // UTC-anchored arithmetic must not drift an hour and skip or repeat a day.
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(daysBetween("2026-10-24", "2026-10-27")).toBe(3);
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("builds a contiguous window", () => {
    expect(dayRange("2026-08-31", 4)).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("snaps to Monday and indexes weekdays from Monday", () => {
    // 2026-09-01 is a Tuesday.
    expect(mondayOf("2026-09-01")).toBe("2026-08-31");
    expect(mondayOf("2026-08-31")).toBe("2026-08-31");
    expect(mondayOf("2026-09-06")).toBe("2026-08-31");
    expect(weekdayIndex("2026-08-31")).toBe(0);
    expect(weekdayIndex("2026-09-06")).toBe(6);
  });

  it("marks Saturday and Sunday as weekend", () => {
    expect(isWeekend("2026-09-04")).toBe(false); // Friday
    expect(isWeekend("2026-09-05")).toBe(true); // Saturday
    expect(isWeekend("2026-09-06")).toBe(true); // Sunday
    expect(isWeekend("2026-09-07")).toBe(false); // Monday
  });

  it("computes ISO week numbers from any day in the week", () => {
    expect(isoWeekNumber("2026-08-31")).toEqual({ week: 36, year: 2026 });
    expect(isoWeekNumber("2026-09-06")).toEqual({ week: 36, year: 2026 });
    expect(isoWeekNumber("2025-12-29")).toEqual({ week: 1, year: 2026 });
  });
});

describe("describing a window of day columns", () => {
  // The grid used to derive all of this per cell. These assertions pin the
  // equivalence, so the fast path cannot drift from the helpers it replaced.
  const window = () =>
    describeDays({ windowStart: "2026-08-31", windowDays: 28, today: "2026-09-04", horizonDays: 14 });

  it("produces one entry per day, in order, starting at the window start", () => {
    const days = window();
    expect(days).toHaveLength(28);
    expect(days[0].key).toBe("2026-08-31");
    expect(days[27].key).toBe(addDays("2026-08-31", 27));
    expect(days.map((d) => d.key)).toEqual(dayRange("2026-08-31", 28));
  });

  it("agrees with the per-day helpers it replaced", () => {
    for (const day of window()) {
      expect(day.weekend).toBe(isWeekend(day.key));
      expect(day.weekdayLabel).toBe(formatWeekday(day.key));
      expect(day.dayOfMonth).toBe(parseDateKey(day.key).getUTCDate());
      expect(day.isoWeek).toBe(isoWeekNumber(day.key).week);
      expect(day.inPast).toBe(day.key < "2026-09-04");
      expect(day.beyondHorizon).toBe(daysBetween("2026-09-04", day.key) > 14);
    }
  });

  it("marks today, and only today", () => {
    const today = window().filter((d) => d.isToday);
    expect(today.map((d) => d.key)).toEqual(["2026-09-04"]);
  });

  it("draws a week rule on every Monday except the first column", () => {
    // The window starts ON a Monday: it gets no rule, the later ones do.
    const days = window();
    expect(days[0].weekdayLabel).toBe("Mo");
    expect(days[0].weekBoundary).toBe(false);
    expect(days.filter((d) => d.weekBoundary).map((d) => d.key)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
  });

  it("steps correctly across a month boundary and a DST change", () => {
    const days = describeDays({
      windowStart: "2026-10-24",
      windowDays: 4,
      today: "2026-10-24",
      horizonDays: 84,
    });
    // Europe/Zurich clocks change on 2026-10-25; UTC-anchored stepping must not
    // repeat or skip a day.
    expect(days.map((d) => d.key)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(days.map((d) => d.dayOfMonth)).toEqual([24, 25, 26, 27]);
  });

  it("treats the horizon as inclusive, matching checkReservation", () => {
    const days = describeDays({
      windowStart: "2026-09-04",
      windowDays: 20,
      today: "2026-09-04",
      horizonDays: 14,
    });
    const byKey = new Map(days.map((d) => [d.key, d]));
    expect(byKey.get("2026-09-18")!.beyondHorizon).toBe(false); // day 14
    expect(byKey.get("2026-09-19")!.beyondHorizon).toBe(true); // day 15
    // The grid and the booking check must refuse the same day.
    expect(
      checkReservation({
        startDate: "2026-09-19",
        endDate: "2026-09-19",
        today: "2026-09-04",
        horizonDays: 14,
        existing: [],
      }).ok,
    ).toBe(false);
  });
});

describe("month bands above the calendar", () => {
  it("collapses consecutive days into one band per month", () => {
    const days = describeDays({
      windowStart: "2026-08-31",
      windowDays: 28,
      today: "2026-08-31",
      horizonDays: 84,
    });
    expect(monthBands(days)).toEqual([
      { label: "August 2026", span: 1 },
      { label: "September 2026", span: 27 },
    ]);
  });

  it("spans add up to the window length", () => {
    const days = describeDays({
      windowStart: "2026-12-20",
      windowDays: 28,
      today: "2026-12-20",
      horizonDays: 84,
    });
    const bands = monthBands(days);
    expect(bands.reduce((sum, b) => sum + b.span, 0)).toBe(28);
    // Across a year boundary the year is part of the label, so December 2026
    // and January 2027 never merge.
    expect(bands.map((b) => b.label)).toEqual(["December 2026", "January 2027"]);
  });

  it("is empty for an empty window", () => {
    expect(monthBands([])).toEqual([]);
  });
});

describe("formatting", () => {
  it("renders single days", () => {
    expect(formatDay("2026-09-04")).toBe("4 Sep");
    expect(formatWeekday("2026-09-04")).toBe("Fr");
    expect(formatDayLong("2026-09-04")).toBe("Fr 4 Sep");
  });

  it("collapses the month inside one month, and keeps both across a boundary", () => {
    expect(formatSpan("2026-09-04", "2026-09-04")).toBe("4 Sep");
    expect(formatSpan("2026-09-04", "2026-09-08")).toBe("4 – 8 Sep");
    expect(formatSpan("2026-08-31", "2026-09-02")).toBe("31 Aug – 2 Sep");
  });

  it("does not collapse the same month number in different years", () => {
    expect(formatSpan("2026-09-28", "2027-09-02")).toBe("28 Sep – 2 Sep");
  });
});

describe("reservation spans", () => {
  it("is due on the last booked day itself", () => {
    expect(dueDateOf({ end_date: "2026-09-03" })).toBe("2026-09-03");
  });

  it("detects inclusive overlap, including a single shared day", () => {
    const a = span({ start_date: "2026-09-01", end_date: "2026-09-03" });
    const b = span({ id: "r2", start_date: "2026-09-03", end_date: "2026-09-05" });
    const c = span({ id: "r3", start_date: "2026-09-04", end_date: "2026-09-06" });
    expect(spansOverlap(a, b)).toBe(true);
    expect(spansOverlap(a, c)).toBe(false);
  });

  it("lets a booking start the day after another ends", () => {
    const existing = [span({ id: "live", start_date: "2026-09-01", end_date: "2026-09-03" })];
    const result = checkReservation({
      startDate: "2026-09-04",
      endDate: "2026-09-06",
      today: "2026-09-01",
      horizonDays: 56,
      existing,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an overlap with a live booking but ignores cancelled and returned ones", () => {
    const existing = [
      span({ id: "live", start_date: "2026-09-07", end_date: "2026-09-09" }),
      span({ id: "dead", start_date: "2026-09-14", end_date: "2026-09-14", status: "cancelled" }),
      span({ id: "done", start_date: "2026-09-21", end_date: "2026-09-21", status: "returned" }),
    ];
    const base = { today: "2026-09-01", horizonDays: 84, existing };

    const clash = checkReservation({ ...base, startDate: "2026-09-08", endDate: "2026-09-10" });
    expect(clash.ok).toBe(false);
    if (!clash.ok && clash.reason === "overlap") {
      expect(clash.conflicting.map((s) => s.id)).toEqual(["live"]);
    } else {
      expect.unreachable("expected an overlap conflict");
    }

    expect(checkReservation({ ...base, startDate: "2026-09-14", endDate: "2026-09-14" }).ok).toBe(true);
    expect(checkReservation({ ...base, startDate: "2026-09-21", endDate: "2026-09-21" }).ok).toBe(true);
  });

  it("lets an edit ignore its own row", () => {
    const existing = [span({ id: "mine", start_date: "2026-09-07", end_date: "2026-09-07" })];
    const result = checkReservation({
      startDate: "2026-09-07",
      endDate: "2026-09-09",
      today: "2026-09-01",
      horizonDays: 84,
      existing,
      ignoreId: "mine",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses inverted, past, over-long and beyond-horizon spans", () => {
    const base = { today: "2026-09-01", existing: [] as ReservationSpan[], horizonDays: 28 };
    expect(checkReservation({ ...base, startDate: "2026-09-10", endDate: "2026-09-08" })).toEqual({
      ok: false,
      reason: "inverted",
    });
    expect(checkReservation({ ...base, startDate: "2026-08-31", endDate: "2026-08-31" })).toEqual({
      ok: false,
      reason: "past",
    });
    expect(checkReservation({ ...base, startDate: "2026-09-01", endDate: "2026-12-01" })).toEqual({
      ok: false,
      reason: "too_long",
      maxDays: 84,
    });
    // horizon 28 => day 28 out is allowed, day 29 refused.
    expect(checkReservation({ ...base, startDate: "2026-09-29", endDate: "2026-09-29" }).ok).toBe(true);
    expect(checkReservation({ ...base, startDate: "2026-09-30", endDate: "2026-09-30" })).toEqual({
      ok: false,
      reason: "beyond_horizon",
      horizonDays: 28,
    });
  });

  it("allows booking today itself", () => {
    const result = checkReservation({
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      today: "2026-09-01",
      horizonDays: 56,
      existing: [],
    });
    expect(result.ok).toBe(true);
  });

  it("allows a booking exactly at the maximum length", () => {
    const result = checkReservation({
      startDate: "2026-09-01",
      endDate: addDays("2026-09-01", 83),
      today: "2026-09-01",
      horizonDays: 84,
      existing: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe("how long a booking actually occupied the asset", () => {
  const booked = (extra: Partial<ReservationSpan>) =>
    span({ start_date: "2026-09-14", end_date: "2026-09-18", ...extra });

  it("runs to the end date while the booking is live", () => {
    expect(occupiedUntil(booked({ status: "reserved" }))).toBe("2026-09-18");
    expect(occupiedUntil(booked({ status: "picked_up" }))).toBe("2026-09-18");
  });

  it("stops on the day the material came back early", () => {
    expect(occupiedUntil(booked({ status: "returned", returned_on: "2026-09-16" }))).toBe("2026-09-16");
  });

  it("collapses to a single day when it came back the day it went out", () => {
    expect(occupiedUntil(booked({ status: "returned", returned_on: "2026-09-14" }))).toBe("2026-09-14");
  });

  it("does not stretch past the end date when the return was late", () => {
    // Lateness is shown by the overdue marking, not by drawing the booking
    // over days it was never booked for.
    expect(occupiedUntil(booked({ status: "returned", returned_on: "2026-09-25" }))).toBe("2026-09-18");
  });

  it("falls back to the end date when no return date was recorded", () => {
    expect(occupiedUntil(booked({ status: "returned", returned_on: null }))).toBe("2026-09-18");
  });

  it("never inverts the span", () => {
    // Bad data must not produce a booking that ends before it begins.
    const odd = booked({ status: "returned", returned_on: "2026-09-01" });
    expect(occupiedUntil(odd)).toBe("2026-09-14");
    expect(occupiedUntil(odd) >= odd.start_date).toBe(true);
  });

  it("is never the same thing as the due date", () => {
    // `dueDateOf` drives lateness and reminders and must stay the day that was
    // promised, whatever actually happened.
    const early = booked({ status: "returned", returned_on: "2026-09-16" });
    expect(dueDateOf(early)).toBe("2026-09-18");
    expect(occupiedUntil(early)).toBe("2026-09-16");
  });
});

describe("which calendar layer a booking is drawn in", () => {
  it("draws live bookings in the live layer", () => {
    expect(calendarLayerFor("reserved", true)).toBe("live");
    expect(calendarLayerFor("picked_up", true)).toBe("live");
  });

  it("draws finished bookings in the history layer", () => {
    expect(calendarLayerFor("returned", true)).toBe("history");
  });

  it("hides finished bookings when past bookings are switched off", () => {
    expect(calendarLayerFor("returned", false)).toBeNull();
  });

  it("NEVER hides a booking that still holds the asset", () => {
    // The safety property. Hiding a live booking would draw a booked unit as
    // free and let somebody book on top of it, so `showPast` must not reach
    // these two statuses at all.
    expect(calendarLayerFor("reserved", false)).toBe("live");
    expect(calendarLayerFor("picked_up", false)).toBe("live");
  });

  it("never draws bookings that hold nothing", () => {
    for (const showPast of [true, false]) {
      expect(calendarLayerFor("cancelled", showPast)).toBeNull();
      expect(calendarLayerFor("waitlisted", showPast)).toBeNull();
    }
  });

  it("agrees with isBlocking about what is live", () => {
    const statuses = ["reserved", "picked_up", "returned", "cancelled", "waitlisted"] as const;
    for (const status of statuses) {
      expect(calendarLayerFor(status, true) === "live").toBe(isBlocking(status));
      expect(calendarLayerFor(status, false) === "live").toBe(isBlocking(status));
    }
  });
});

describe("lateness", () => {
  it("counts days past the due day only while the item is still out", () => {
    const out = span({ start_date: "2026-08-24", end_date: "2026-08-28", status: "picked_up" });
    expect(dueDateOf(out)).toBe("2026-08-28");
    expect(daysOverdue(out, "2026-08-28")).toBe(0);
    expect(daysOverdue(out, "2026-08-31")).toBe(3);

    const back = span({ ...out, status: "returned", returned_on: "2026-08-31" });
    expect(daysOverdue(back, "2026-09-10")).toBe(0);
    expect(lateDays(back)).toBe(3);
  });

  it("treats an early or on-time return as not late", () => {
    const onTime = span({
      start_date: "2026-08-24",
      end_date: "2026-08-28",
      status: "returned",
      returned_on: "2026-08-28",
    });
    expect(lateDays(onTime)).toBe(0);
    expect(lateDays(span({ ...onTime, returned_on: "2026-08-26" }))).toBe(0);
  });
});

describe("reliability score", () => {
  const today = "2026-09-01";

  it("starts provisional with no history", () => {
    const r = computeReliability([], today);
    expect(r.score).toBe(PROVISIONAL_SCORE);
    expect(r.tier).toBe("standard");
    expect(r.horizonDays).toBe(56);
    expect(r.summary).toBe("No return history yet");
  });

  it("rewards a clean record up to the cap", () => {
    const clean = Array.from({ length: 20 }, (_, i) =>
      span({
        id: `r${i}`,
        start_date: "2026-06-01",
        end_date: "2026-06-03",
        status: "returned",
        returned_on: "2026-06-03",
      }),
    );
    const r = computeReliability(clean, today);
    expect(r.score).toBe(100);
    expect(r.tier).toBe("trusted");
    expect(r.horizonDays).toBe(84);
    expect(r.summary).toBe("20 returns, all on time");
  });

  it("penalises a late return in proportion to how late it was", () => {
    const mild = computeReliability(
      [span({ start_date: "2026-06-01", end_date: "2026-06-03", status: "returned", returned_on: "2026-06-05" })],
      today,
    );
    // 2 days late => 100 - (4 + 2*2) = 92
    expect(mild.score).toBe(92);

    const bad = computeReliability(
      [span({ start_date: "2026-06-01", end_date: "2026-06-03", status: "returned", returned_on: "2026-07-20" })],
      today,
    );
    // 47 days late => penalty capped at 30 => 70
    expect(bad.score).toBe(70);
  });

  it("punishes material that is still out harder, and keeps growing the penalty", () => {
    const out = span({ start_date: "2026-08-10", end_date: "2026-08-16", status: "picked_up" });
    // due 2026-08-16; on 2026-09-01 that is 16 days => capped at 45 => 55
    const r = computeReliability([out], today);
    expect(r.score).toBe(55);
    expect(r.overdue).toBe(1);
    expect(r.tier).toBe("watch");
    expect(r.horizonDays).toBe(28);
    expect(r.summary).toBe("1 item still out past the due date");
  });

  it("drops a chronic offender to restricted, with a one-week horizon", () => {
    const spans = [
      span({ id: "a", start_date: "2026-06-01", end_date: "2026-06-01", status: "picked_up" }),
      span({ id: "b", start_date: "2026-06-08", end_date: "2026-06-08", status: "picked_up" }),
      span({
        id: "c",
        start_date: "2026-05-04",
        end_date: "2026-05-04",
        status: "returned",
        returned_on: "2026-06-20",
      }),
    ];
    const r = computeReliability(spans, today);
    expect(r.score).toBe(0);
    expect(r.tier).toBe("restricted");
    expect(r.horizonDays).toBe(7);
  });

  it("ignores cancelled bookings entirely", () => {
    const r = computeReliability(
      [span({ start_date: "2026-06-01", end_date: "2026-06-01", status: "cancelled" })],
      today,
    );
    expect(r.score).toBe(PROVISIONAL_SCORE);
    expect(r.completed).toBe(0);
  });

  it("does not penalise a booking that has not come due yet", () => {
    const r = computeReliability(
      [span({ start_date: "2026-09-07", end_date: "2026-09-14", status: "reserved" })],
      today,
    );
    expect(r.score).toBe(PROVISIONAL_SCORE);
    expect(r.overdue).toBe(0);
  });

  it("maps scores onto tiers at the documented boundaries", () => {
    expect(tierFor(85).tier).toBe("trusted");
    expect(tierFor(84).tier).toBe("standard");
    expect(tierFor(60).tier).toBe("standard");
    expect(tierFor(59).tier).toBe("watch");
    expect(tierFor(35).tier).toBe("watch");
    expect(tierFor(34).tier).toBe("restricted");
    expect(tierFor(0).tier).toBe("restricted");
  });
});

describe("queue ordering", () => {
  it("puts the higher score first and breaks ties by request time", () => {
    const ordered = orderQueue([
      { reservation_id: "c", user_id: "u3", score: 40, requested_at: "2026-09-01T08:00:00Z" },
      { reservation_id: "a", user_id: "u1", score: 90, requested_at: "2026-09-01T10:00:00Z" },
      { reservation_id: "b", user_id: "u2", score: 90, requested_at: "2026-09-01T09:00:00Z" },
    ]);
    expect(ordered.map((e) => e.reservation_id)).toEqual(["b", "a", "c"]);
  });

  it("is deterministic and does not mutate its input", () => {
    const input = [
      { reservation_id: "b", user_id: "u2", score: 50, requested_at: "2026-09-01T09:00:00Z" },
      { reservation_id: "a", user_id: "u1", score: 50, requested_at: "2026-09-01T09:00:00Z" },
    ];
    const snapshot = [...input];
    expect(orderQueue(input).map((e) => e.reservation_id)).toEqual(["a", "b"]);
    expect(input).toEqual(snapshot);
  });
});

describe("reminder schedule", () => {
  const out = span({ start_date: "2026-08-24", end_date: "2026-08-30", status: "picked_up" });
  // due 2026-08-30

  it("nudges the day before and on the due date", () => {
    expect(reminderFor(out, "2026-08-29")).toBe("due_soon");
    expect(reminderFor(out, "2026-08-30")).toBe("due_today");
  });

  it("stays quiet earlier in the booking", () => {
    expect(reminderFor(out, "2026-08-25")).toBeNull();
    expect(reminderFor(out, "2026-08-28")).toBeNull();
  });

  it("chases daily for a week, then every third day", () => {
    expect(reminderFor(out, "2026-08-31")).toBe("overdue"); // +1
    expect(reminderFor(out, "2026-09-06")).toBe("overdue"); // +7
    expect(reminderFor(out, "2026-09-07")).toBeNull(); // +8
    expect(reminderFor(out, "2026-09-08")).toBe("overdue"); // +9, divisible by 3
    expect(reminderFor(out, "2026-09-09")).toBeNull(); // +10
  });

  it("says nothing once the item is back or the booking is cancelled", () => {
    expect(reminderFor(span({ ...out, status: "returned", returned_on: "2026-09-02" }), "2026-09-02")).toBeNull();
    expect(reminderFor(span({ ...out, status: "cancelled" }), "2026-08-30")).toBeNull();
  });

  it("fires for a single-day booking on the day itself", () => {
    const oneDay = span({ start_date: "2026-08-30", end_date: "2026-08-30", status: "picked_up" });
    expect(reminderFor(oneDay, "2026-08-29")).toBe("due_soon");
    expect(reminderFor(oneDay, "2026-08-30")).toBe("due_today");
    expect(reminderFor(oneDay, "2026-08-31")).toBe("overdue");
  });

  it("stops chasing after a month — by then it is an admin's problem, not a 31st e-mail's", () => {
    expect(OVERDUE_REMINDER_DAYS).toBe(30);
    expect(reminderFor(out, "2026-09-29")).toBe("overdue"); // +30, divisible by 3: the last one
    expect(reminderFor(out, "2026-10-02")).toBeNull(); // +33 would have fired before
    expect(reminderFor(out, "2026-12-01")).toBeNull();
  });
});

describe("an overdue unit keeps blocking until it is back", () => {
  const out = span({ start_date: "2026-08-24", end_date: "2026-08-28", status: "picked_up" });

  it("blocks through today once past due, but only while the unit is actually out", () => {
    expect(blockedUntil(out, "2026-08-26")).toBe("2026-08-28"); // within the span: the due date
    expect(blockedUntil(out, "2026-09-02")).toBe("2026-09-02"); // overdue and still out: today
    // Never collected: a no-show, blocks nothing past its own span.
    expect(blockedUntil(span({ ...out, status: "reserved" }), "2026-09-02")).toBe("2026-08-28");
    // Back: history, the due date stands.
    expect(blockedUntil(span({ ...out, status: "returned", returned_on: "2026-09-01" }), "2026-09-02")).toBe(
      "2026-08-28",
    );
  });

  it("refuses to book today a unit that has not come back", () => {
    const check = checkReservation({
      startDate: "2026-09-02",
      endDate: "2026-09-03",
      today: "2026-09-02",
      horizonDays: 56,
      existing: [out],
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("overlap");
  });

  it("still lets tomorrow be booked — the unit may well be back by then", () => {
    const check = checkReservation({
      startDate: "2026-09-03",
      endDate: "2026-09-03",
      today: "2026-09-02",
      horizonDays: 56,
      existing: [out],
    });
    expect(check.ok).toBe(true);
  });

  it("does not stretch a never-collected booking over the following days", () => {
    const noShow = span({ ...out, status: "reserved" });
    const check = checkReservation({
      startDate: "2026-09-02",
      endDate: "2026-09-02",
      today: "2026-09-02",
      horizonDays: 56,
      existing: [noShow],
    });
    expect(check.ok).toBe(true);
  });
});

describe("interchangeable units", () => {
  const today = "2026-09-14";
  const unit = (id: string, kind_key: string | null, extra: Partial<SiblingAsset> = {}): SiblingAsset => ({
    id,
    name: id.toUpperCase(),
    kind_key,
    pooled: true,
    status: "available",
    current_location: "Lausanne",
    ...extra,
  });

  it("normalises a kind into one slug", () => {
    expect(normalizeKindKey("Elios 3")).toBe("elios-3");
    expect(normalizeKindKey("  elios-3 ")).toBe("elios-3");
    expect(normalizeKindKey("LiDAR Rev 7")).toBe("lidar-rev-7");
    expect(normalizeKindKey("")).toBeNull();
    expect(normalizeKindKey("---")).toBeNull();
    expect(normalizeKindKey(null)).toBeNull();
  });

  it("offers only free, bookable units of the same kind — never the unit itself", () => {
    const assets = [
      unit("sva-257", "elios-3"),
      unit("sva-330", "elios-3"),
      unit("sva-400", "elios-3", { status: "in_repair" }),
      unit("sva-500", "elios-3", { pooled: false }),
      unit("sva-600", "elios-3", { active: false }),
      unit("rev-7", "lidar-rev-7"),
      unit("sva-700", null),
    ];
    const spans = [span({ id: "x", asset_id: "sva-330", start_date: "2026-09-10", end_date: "2026-09-13", status: "returned", returned_on: "2026-09-13" })];
    const free = freeSiblings({ asset: assets[0], startDate: "2026-09-14", endDate: "2026-09-16", today, assets, spans });
    expect(free).toEqual([{ asset_id: "sva-330", name: "SVA-330", location: "Lausanne" }]);
  });

  it("treats an overdue sibling as taken through today, and a unit with no kind as having none", () => {
    const assets = [unit("a", "elios-3"), unit("b", "elios-3"), unit("c", null), unit("d", null)];
    const overdue = span({ id: "o", asset_id: "b", start_date: "2026-09-08", end_date: "2026-09-10", status: "picked_up" });
    expect(freeSiblings({ asset: assets[0], startDate: today, endDate: today, today, assets, spans: [overdue] })).toEqual([]);
    expect(freeSiblings({ asset: assets[0], startDate: "2026-09-15", endDate: "2026-09-15", today, assets, spans: [overdue] })).toHaveLength(1);
    expect(freeSiblings({ asset: assets[2], startDate: today, endDate: today, today, assets, spans: [] })).toEqual([]);
  });
});

describe("no-shows", () => {
  const today = "2026-09-01";

  it("is not 'overdue' — nothing is out", () => {
    const lapsed = span({ start_date: "2026-08-24", end_date: "2026-08-28", status: "reserved" });
    expect(daysOverdue(lapsed, today)).toBe(0);
    expect(computeReliability([lapsed], today).overdue).toBe(0);
  });

  it("decides what the daily sweep closes", () => {
    const reserved = span({ start_date: "2026-08-24", end_date: "2026-08-28", status: "reserved" });
    expect(expiryFor(reserved, "2026-08-28")).toBeNull(); // the last day is still today
    expect(expiryFor(reserved, "2026-08-29")).toBe("no_show");
    expect(expiryFor(span({ ...reserved, status: "waitlisted" }), "2026-08-29")).toBe("expired");
    // Material that is out is overdue, not expired — only a check-in closes it.
    expect(expiryFor(span({ ...reserved, status: "picked_up" }), "2026-08-29")).toBeNull();
    expect(expiryFor(span({ ...reserved, status: "returned", returned_on: "2026-08-28" }), "2026-08-29")).toBeNull();
  });

  it("costs a little, is capped, and never lifts anyone off the provisional start", () => {
    const noShow = (id: string) =>
      span({ id, start_date: "2026-08-01", end_date: "2026-08-02", status: "cancelled", closed_reason: "no_show" });

    const first = computeReliability([noShow("a")], today);
    expect(first.noShows).toBe(1);
    expect(first.score).toBe(PROVISIONAL_SCORE - NO_SHOW_PENALTY);
    expect(first.summary).toBe("No returns yet, 1 booking never collected");

    const onTime = span({ id: "ok", start_date: "2026-08-10", end_date: "2026-08-11", status: "returned", returned_on: "2026-08-11" });
    expect(computeReliability([onTime, noShow("a")], today).score).toBe(100 + 2 - NO_SHOW_PENALTY);

    const many = ["a", "b", "c", "d", "e", "f", "g"].map(noShow);
    expect(computeReliability([onTime, ...many], today).score).toBe(100 + 2 - NO_SHOW_PENALTY_CAP);
  });

  it("leaves an ordinary cancellation, and an expired waitlist entry, unscored", () => {
    const plain = span({ start_date: "2026-08-01", end_date: "2026-08-02", status: "cancelled", closed_reason: "cancelled" });
    const expired = span({ id: "w", start_date: "2026-08-01", end_date: "2026-08-02", status: "cancelled", closed_reason: "expired" });
    const r = computeReliability([plain, expired], today);
    expect(r.score).toBe(PROVISIONAL_SCORE);
    expect(r.noShows).toBe(0);
  });
});


describe("imported bookings are excluded from scoring", () => {
  const today = "2026-09-01";

  it("does not penalise a long-overdue sheet import", () => {
    // Exactly the shape the sheet importer writes: out, past due, provisional.
    const imported = span({
      id: "imported",
      start_date: "2026-06-01",
      end_date: "2026-06-08",
      status: "picked_up",
      source: "sheet_import",
    });
    const r = computeReliability([imported], today);
    expect(r.score).toBe(PROVISIONAL_SCORE);
    expect(r.overdue).toBe(0);
    expect(r.summary).toBe("No return history yet");
  });

  it("still scores the person's own app bookings alongside imported ones", () => {
    const spans = [
      span({ id: "imported", start_date: "2026-06-01", end_date: "2026-06-08", status: "picked_up", source: "sheet_import" }),
      span({
        id: "real",
        start_date: "2026-07-01",
        end_date: "2026-07-03",
        status: "returned",
        returned_on: "2026-07-05",
        source: "app",
      }),
    ];
    const r = computeReliability(spans, today);
    // Only the real one counts: 2 days late => 100 - (4 + 2*2) = 92.
    expect(r.score).toBe(92);
    expect(r.completed).toBe(1);
    expect(r.overdue).toBe(0);
  });

  it("treats a span with no source as an app booking", () => {
    const r = computeReliability(
      [span({ start_date: "2026-06-01", end_date: "2026-06-08", status: "picked_up" })],
      today,
    );
    expect(r.overdue).toBe(1);
    expect(r.score).toBeLessThan(PROVISIONAL_SCORE);
  });

  it("blocks the calendar even though it does not score", () => {
    // An imported booking must still stop someone else booking the same days.
    const imported = span({
      id: "imported",
      start_date: "2026-09-10",
      end_date: "2026-09-12",
      status: "picked_up",
      source: "sheet_import",
    });
    const result = checkReservation({
      startDate: "2026-09-11",
      endDate: "2026-09-11",
      today,
      horizonDays: 56,
      existing: [imported],
    });
    expect(result.ok).toBe(false);
  });
});

describe("holder label matching", () => {
  it("normalises case, accents, punctuation and spacing", () => {
    expect(normalizeHolderLabel("  Charles  ")).toBe("charles");
    expect(normalizeHolderLabel("Wataru.")).toBe("wataru");
    expect(normalizeHolderLabel("Fran\u00e7ois")).toBe("francois");
    expect(normalizeHolderLabel("Office   Paudex")).toBe("office paudex");
  });

  it("takes first and last name, dropping middles and initials", () => {
    expect(nameTokens("Tiago Leconte Pais")).toEqual({ first: "tiago", last: "pais" });
    expect(nameTokens("Emil")).toEqual({ first: "emil", last: null });
    expect(nameTokens("J. Smith")).toEqual({ first: "smith", last: null });
    expect(nameTokens("   ")).toEqual({ first: null, last: null });
  });

  it("matches on a shared FIRST name", () => {
    const emil = { name: "Emil Wallnofer", email: "emil.wallnofer@flyability.com" };
    expect(holderLabelMatchesPerson("Emil", emil)).toBe(true);
    expect(holderLabelMatchesPerson("Emil Wallnofer", emil)).toBe(true);
  });

  it("matches on a shared LAST name", () => {
    // The sheet sometimes writes only a surname; that is still the same person.
    expect(holderLabelMatchesPerson("Wallnofer", { name: "Emil Wallnofer" })).toBe(true);
    expect(holderLabelMatchesPerson("Rey", { name: "Charles Rey" })).toBe(true);
  });

  it("matches across positions, so a reversed name still lines up", () => {
    expect(holderLabelMatchesPerson("Wallnofer Emil", { name: "Emil Wallnofer" })).toBe(true);
  });

  it("falls back to the email when there is no display name", () => {
    expect(holderLabelMatchesPerson("Wataru", { name: null, email: "wataru@flyability.com" })).toBe(true);
    expect(
      holderLabelMatchesPerson("Wallnofer", { name: null, email: "emil.wallnofer@flyability.com" }),
    ).toBe(true);
  });

  it("still refuses group labels and unrelated people", () => {
    const charles = { name: "Charles Rey", email: "charles.rey@flyability.com" };
    expect(holderLabelMatchesPerson("APAC team", charles)).toBe(false);
    expect(holderLabelMatchesPerson("FPS", charles)).toBe(false);
    expect(holderLabelMatchesPerson("US Office", charles)).toBe(false);
    expect(holderLabelMatchesPerson("Total Energies", charles)).toBe(false);
    expect(holderLabelMatchesPerson("Philipp Jaegle", charles)).toBe(false);
    expect(holderLabelMatchesPerson("Lucas Senault", charles)).toBe(false);
  });

  it("ignores a middle name, which is likelier to collide than to identify", () => {
    // "Leconte" is Tiago's middle name; someone actually called Leconte is not him.
    expect(holderLabelMatchesPerson("Leconte", { name: "Tiago Leconte Pais" })).toBe(false);
  });

  it("refuses tokens too short to identify anyone", () => {
    expect(holderLabelMatchesPerson("Jo", { name: "Jo Smith", email: "jo@x.com" })).toBe(false);
    expect(holderLabelMatchesPerson("", { name: "Charles Rey" })).toBe(false);
    expect(holderLabelMatchesPerson("  -- ", { name: "Charles Rey" })).toBe(false);
  });

  it("is ambiguous by design when two people share a first name", () => {
    // Both match, so the CALLER must refuse to auto-link when more than one does.
    expect(holderLabelMatchesPerson("Philipp", { name: "Philipp Jaegle" })).toBe(true);
    expect(holderLabelMatchesPerson("Philipp", { name: "Philipp Vogel" })).toBe(true);
  });
});

describe("what belongs in the booking calendar", () => {
  it("includes a pooled unit that is free or merely booked", () => {
    expect(isBookable({ pooled: true, status: "available" })).toBe(true);
    expect(isBookable({ pooled: true, status: "reserved" })).toBe(true);
    // Out on a booking is still pool stock — the calendar is how you see when
    // it comes back.
    expect(isBookable({ pooled: true, status: "out" })).toBe(true);
  });

  it("excludes an assigned unit whatever its status", () => {
    expect(isBookable({ pooled: false, status: "available" })).toBe(false);
    expect(isBookable({ pooled: false, status: "out" })).toBe(false);
  });

  it("excludes pooled units nobody could take", () => {
    expect(isBookable({ pooled: true, status: "in_repair" })).toBe(false);
    expect(isBookable({ pooled: true, status: "retired" })).toBe(false);
  });
});


describe("closing a booking when material leaves or rejoins the pool", () => {
  it("records material that was physically out as returned", () => {
    expect(closureStatusFor("picked_up")).toBe("returned");
  });

  it("cancels a booking nobody ever collected", () => {
    expect(closureStatusFor("reserved")).toBe("cancelled");
  });

  it("leaves already-closed bookings alone", () => {
    expect(closureStatusFor("returned")).toBeNull();
    expect(closureStatusFor("cancelled")).toBeNull();
    expect(closureStatusFor("waitlisted")).toBeNull();
  });

  it("does not let an uncollected overdue booking score as a late return", () => {
    // The scenario the split exists for: booked for last week, never picked up,
    // and the asset is now being assigned to someone else. Cancelled, so the
    // score sees nothing; had it closed as `returned` it would have been
    // counted as a return seven days late.
    const span: ReservationSpan = {
      id: "r1",
      asset_id: "a1",
      user_id: "u1",
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      status: closureStatusFor("reserved")!,
      returned_on: "2026-09-10",
    };
    expect(span.status).toBe("cancelled");
    expect(computeReliability([span], "2026-09-10").score).toBe(PROVISIONAL_SCORE);
  });
});


describe("holder colours", () => {
  it("is stable for the same person across calls", () => {
    const a = holderColorIndex("Inga Khchoyan");
    const b = holderColorIndex("Inga Khchoyan");
    expect(a).toBe(b);
    expect(holderRgb("Inga Khchoyan")).toBe(holderRgb("Inga Khchoyan"));
  });

  it("ignores case, spacing and punctuation, so one person gets one colour", () => {
    // The sheet writes the same person several ways; they must not end up with
    // different colours in the calendar and the legend.
    expect(holderColorIndex("Emil Wallnofer")).toBe(holderColorIndex("  emil   wallnofer "));
    expect(holderColorIndex("François Theil")).toBe(holderColorIndex("Francois Theil"));
  });

  it("always lands inside the palette", () => {
    const names = [
      "Charles Rey", "Camilla Grosso", "François Theil", "Tiago Leconte Pais",
      "Emil Wallnofer", "Inga Khchoyan", "Lucas Senault", "Paul Samuel",
      "Fabio Fata", "Matteo Saglia", "Philipp Jaegle", "Igor Stapper",
      "USA", "Total Energies", "", "   ",
    ];
    for (const n of names) {
      const i = holderColorIndex(n);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(HOLDER_COLORS.length);
      expect(holderRgb(n)).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  it("keeps the palette free of near-duplicate colours", () => {
    // The point of fourteen colours is fourteen colours. The old palette named
    // twelve Tailwind hues but contained four blue-greens and three pinks, so
    // this pins a minimum separation rather than trusting the names.
    const rgb = HOLDER_COLORS.map((c) => c.rgb.split(" ").map(Number) as [number, number, number]);
    for (let i = 0; i < rgb.length; i += 1) {
      for (let j = i + 1; j < rgb.length; j += 1) {
        const distance = Math.hypot(
          rgb[i][0] - rgb[j][0],
          rgb[i][1] - rgb[j][1],
          rgb[i][2] - rgb[j][2],
        );
        expect(
          distance,
          `${HOLDER_COLORS[i].name} and ${HOLDER_COLORS[j].name} are too close`,
        ).toBeGreaterThan(60);
      }
    }
  });
});

describe("assignHolderColors", () => {
  const ROSTER = [
    "Charles Rey", "Camilla Grosso", "François Theil", "Tiago Leconte Pais",
    "Emil Wallnofer", "Inga Khchoyan", "Lucas Senault", "Paul Samuel",
    "Fabio Fata", "Matteo Saglia", "Philipp Jaegle", "Igor Stapper",
  ];

  it("gives every person on the real roster a colour of their own", () => {
    // This is the whole reason the allocation exists: hashing alone put several
    // of these twelve on the same colour, which makes the board lie about who
    // has what.
    const assigned = assignHolderColors(ROSTER);
    expect(assigned.size).toBe(ROSTER.length);
    expect(new Set(assigned.values()).size).toBe(ROSTER.length);
  });

  it("is independent of the order the names arrive in", () => {
    const forwards = assignHolderColors(ROSTER);
    const backwards = assignHolderColors([...ROSTER].reverse());
    for (const [key, rgb] of forwards) expect(backwards.get(key)).toBe(rgb);
  });

  it("treats one person written several ways as one person", () => {
    const assigned = assignHolderColors(["Emil Wallnofer", "  emil   wallnofer ", "EMIL WALLNOFER"]);
    expect(assigned.size).toBe(1);
  });

  it("ignores blanks rather than allocating a colour to nothing", () => {
    const assigned = assignHolderColors(["", "   ", "Emil Wallnofer"]);
    expect(assigned.size).toBe(1);
  });

  it("fills the whole palette before any colour is reused", () => {
    const many = Array.from({ length: HOLDER_COLORS.length }, (_, i) => `Person ${i}`);
    const assigned = assignHolderColors(many);
    expect(new Set(assigned.values()).size).toBe(HOLDER_COLORS.length);
  });

  it("still gives everyone a colour past the size of the palette", () => {
    // Beyond fourteen the pigeonhole wins and colours repeat, but nobody may be
    // left without one.
    const many = Array.from({ length: HOLDER_COLORS.length + 6 }, (_, i) => `Person ${i}`);
    const assigned = assignHolderColors(many);
    expect(assigned.size).toBe(many.length);
    for (const rgb of assigned.values()) expect(rgb).toMatch(/^\d+ \d+ \d+$/);
  });
});


describe("directory-backed matching", () => {
  // The fleet list names holders by first name while accounts are emails. The
  // directory records that mapping; these cases are why it has to exist rather
  // than being inferred.
  it("cannot separate two people who share a first name by name alone", () => {
    const label = "Philipp";
    expect(holderLabelMatchesPerson(label, { name: "Philipp Jaegle" })).toBe(true);
    expect(holderLabelMatchesPerson(label, { name: "Philipp Vogel" })).toBe(true);
    // Both match, so nothing but a recorded email can tell them apart.
  });

  it("matches a first-name label to a full-name account", () => {
    // "ASSIGNED (CHARLES)" against charles.rey@flyability.com.
    expect(holderLabelMatchesPerson("Charles", { name: null, email: "charles.rey@flyability.com" })).toBe(true);
    expect(holderLabelMatchesPerson("Tiago", { name: null, email: "tiago.lecontepais@flyability.com" })).toBe(true);
    expect(holderLabelMatchesPerson("Igor", { name: null, email: "igor.stapper@flyability.com" })).toBe(true);
  });

  it("survives a spelling difference between the sheet and the account", () => {
    // The roadshow sheet wrote "Wallnofer"; the account is "wallnoefer".
    // The first name still carries the match, which is why first OR last works.
    expect(
      holderLabelMatchesPerson("Emil", { name: null, email: "emil.wallnoefer@flyability.com" }),
    ).toBe(true);
  });

  it("does not match an external holder to anyone", () => {
    const people = [
      { name: "Charles Rey", email: "charles.rey@flyability.com" },
      { name: "Igor Stapper", email: "igor.stapper@flyability.com" },
    ];
    for (const p of people) {
      expect(holderLabelMatchesPerson("Total Energies", p)).toBe(false);
      expect(holderLabelMatchesPerson("USA", p)).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("dueLabel", () => {
  it("speaks in today and tomorrow before it speaks in counts", () => {
    expect(dueLabel("2026-09-14", "2026-09-14")).toBe("due back today");
    expect(dueLabel("2026-09-15", "2026-09-14")).toBe("due back tomorrow");
    expect(dueLabel("2026-09-18", "2026-09-14")).toBe("due back in 4 days");
  });

  it("counts lateness in whole days, singular at one", () => {
    expect(dueLabel("2026-09-13", "2026-09-14")).toBe("1 day overdue");
    expect(dueLabel("2026-09-10", "2026-09-14")).toBe("4 days overdue");
  });
});

