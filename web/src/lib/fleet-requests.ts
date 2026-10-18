import { addDays, daysBetween, MAX_RESERVATION_DAYS, spanLength, type ReservationSpan } from "./fleet-rules";

/**
 * Pure rules for changing a booking's dates and for the extension requests
 * that follow when the new days belong to someone else.
 *
 * `Date.now()`-free, like `fleet-rules.ts`: `today` is always passed in.
 */

export type RequestStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";
/** How an accepted request was honoured. `move` arrives with phase 4. */
export type RequestResolution = "shorten" | "cancel" | "move";
/** What the recipient may answer today. */
export type RequestReply = "shorten" | "cancel" | "decline";

/** One request as the board hands it to the client, names resolved. */
export type FleetRequestView = {
  id: string;
  status: RequestStatus;
  resolution: RequestResolution | null;
  requested_end_date: string;
  created_at: string;
  resolved_at: string | null;
  requester_id: string | null;
  requester_name: string;
  recipient_id: string | null;
  recipient_name: string;
  /** The booking that wants to grow. */
  reservation_id: string;
  asset_id: string;
  asset_name: string;
  current_end_date: string;
  /** The booking it would grow into. */
  target_reservation_id: string;
  target_start_date: string;
  target_end_date: string;
  /** The viewer has to answer this one (recipient, or admin when the target has no account). */
  incoming: boolean;
  /** The viewer asked this one. */
  outgoing: boolean;
  /** Free units of the same kind the recipient could move their booking to (pending incoming only). */
  alternatives: Array<{ asset_id: string; name: string; location: string | null }>;
};

export type DateChange =
  /** The booking grows; `added` is the new stretch that has to be free. */
  | { kind: "extend"; added: { start_date: string; end_date: string } }
  /** The booking gives days back. Never needs anyone's permission. */
  | { kind: "shorten" }
  | { kind: "none" }
  | {
      kind: "invalid";
      reason: "not_live" | "before_start" | "in_past" | "too_long" | "beyond_horizon";
      maxDays?: number;
      horizonDays?: number;
    };

/**
 * Decides what moving a booking's last day to `newEnd` means.
 *
 * - Only a live booking (`reserved` or `picked_up`) can change.
 * - The last day can never be before the first, nor before today: shortening
 *   into the past would pretend material came back before it did — that is
 *   what check-in with a backdated `returned_on` is for.
 * - Growing is bounded by the same two limits as a new booking: the maximum
 *   length, and the requester's horizon measured to the NEW end date.
 * - The added stretch starts the day after the current end, or today when the
 *   booking is already overdue (the days in between are blocked anyway).
 */
export function classifyDateChange(args: {
  span: Pick<ReservationSpan, "start_date" | "end_date" | "status">;
  newEnd: string;
  today: string;
  horizonDays: number;
  maxDays?: number;
}): DateChange {
  const { span, newEnd, today, horizonDays } = args;
  const maxDays = args.maxDays ?? MAX_RESERVATION_DAYS;

  if (span.status !== "reserved" && span.status !== "picked_up") {
    return { kind: "invalid", reason: "not_live" };
  }
  if (newEnd === span.end_date) return { kind: "none" };
  if (newEnd < span.start_date) return { kind: "invalid", reason: "before_start" };
  if (newEnd < today) return { kind: "invalid", reason: "in_past" };
  if (newEnd < span.end_date) return { kind: "shorten" };

  if (spanLength(span.start_date, newEnd) > maxDays) {
    return { kind: "invalid", reason: "too_long", maxDays };
  }
  if (daysBetween(today, newEnd) > horizonDays) {
    return { kind: "invalid", reason: "beyond_horizon", horizonDays };
  }
  const dayAfter = addDays(span.end_date, 1);
  return {
    kind: "extend",
    added: { start_date: dayAfter > today ? dayAfter : today, end_date: newEnd },
  };
}

/** The sentence shown for a refused date change. */
export function dateChangeErrorMessage(change: Extract<DateChange, { kind: "invalid" | "none" }>, score: number): string {
  if (change.kind === "none") return "Those are already the booking's dates.";
  switch (change.reason) {
    case "not_live":
      return "Only a live booking can change its dates.";
    case "before_start":
      return "The last day cannot be before the first.";
    case "in_past":
      return "The last day cannot be before today. If the material is already back, check it in and say which day it came back.";
    case "too_long":
      return `A single booking can run at most ${change.maxDays} days. Split it, or ask an admin.`;
    case "beyond_horizon":
      return `Your reliability score (${score}) lets you book up to ${change.horizonDays} days ahead. Return material on time to book further out.`;
  }
}

/**
 * When the next booker gives up the leading days, their booking now starts the
 * day after the requested end. Null when nothing would be left of it — then
 * the honest answer is to cancel, not to keep a zero-day booking.
 */
export function shortenedStartFor(target: Pick<ReservationSpan, "end_date">, requestedEnd: string): string | null {
  const start = addDays(requestedEnd, 1);
  return start <= target.end_date ? start : null;
}

/**
 * A pending request stops making sense once the target booking's first day
 * arrives: the person is (or should be) standing at the shelf.
 */
export function requestExpired(target: Pick<ReservationSpan, "start_date">, today: string): boolean {
  return target.start_date <= today;
}

/** Short status text for the Requests strip. */
export function requestStatusLabel(status: RequestStatus, resolution: RequestResolution | null): string {
  switch (status) {
    case "pending":
      return "Waiting for an answer";
    case "accepted":
      return resolution === "cancel"
        ? "Accepted — they cancelled their booking"
        : resolution === "move"
          ? "Accepted — they moved to another unit"
          : "Accepted — they start later";
    case "declined":
      return "Declined — get in touch to find a solution";
    case "expired":
      return "Lapsed";
    case "cancelled":
      return "Withdrawn";
  }
}
