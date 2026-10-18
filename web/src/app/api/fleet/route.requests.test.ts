import { describe, expect, it } from "vitest";
import type { Tables } from "@/test/fake-supabase";
import { ADMIN, MEMBER, OTHER, pooledAsset, post, reservation, RESERVATION_ID } from "@/test/fleet-harness";

/**
 * Changing a booking's dates, and the extension requests that follow when the
 * new days belong to someone else (fleet edge cases, phase 2).
 *
 * Clock frozen at 2026-09-14. MEMBER holds the unit 14–16 Sep; OTHER has it
 * booked 17–19 Sep.
 */

const MINE = RESERVATION_ID;
const THEIRS = "bbbbbbbb-0000-4000-8000-000000000002";
const REQUEST = "cccccccc-0000-4000-8000-000000000001";

const mine = (extra: Record<string, unknown> = {}) =>
  reservation({ status: "picked_up", start_date: "2026-09-14", end_date: "2026-09-16", ...extra });
const theirs = (extra: Record<string, unknown> = {}) =>
  reservation({ id: THEIRS, user_id: OTHER.id, start_date: "2026-09-17", end_date: "2026-09-19", status: "reserved", ...extra });
const unit = () => [pooledAsset({ status: "out", current_holder_user_id: MEMBER.id })];

const pendingRequest = (extra: Record<string, unknown> = {}) => ({
  id: REQUEST,
  kind: "extension",
  reservation_id: MINE,
  target_reservation_id: THEIRS,
  requested_end_date: "2026-09-18",
  requester_id: MEMBER.id,
  recipient_id: OTHER.id,
  status: "pending",
  resolution: null,
  created_at: "2026-09-14T08:00:00.000Z",
  resolved_at: null,
  ...extra,
});

const asMember = (tables: Tables) => ({ viewer: MEMBER, users: [MEMBER, OTHER], tables });
const asOther = (tables: Tables) => ({ viewer: OTHER, users: [MEMBER, OTHER], tables });

describe("changing a booking's last day", () => {
  it("extends in place when the days are free", async () => {
    const res = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-09-18",
    });
    expect(res.status).toBe(200);
    expect(res.body.change).toBe("extended");
    expect(res.tables.fleet_reservations[0].end_date).toBe("2026-09-18");
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toContain("extended");
    expect(res.tables.fleet_booking_requests).toHaveLength(0);
  });

  it("files a request instead when the days belong to the next booker — and changes nothing", async () => {
    const res = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine(), theirs()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-09-18",
    });
    expect(res.status).toBe(200);
    expect(res.body.change).toBe("requested");
    expect(res.body.pending).toBe(true);
    expect(String(res.body.message)).toMatch(/asked/i);

    // The booking is exactly as it was; the next booker's too.
    const [myRow, theirRow] = res.tables.fleet_reservations;
    expect(myRow.end_date).toBe("2026-09-16");
    expect(theirRow.start_date).toBe("2026-09-17");

    const [request] = res.tables.fleet_booking_requests;
    expect(request).toMatchObject({
      reservation_id: MINE,
      target_reservation_id: THEIRS,
      requested_end_date: "2026-09-18",
      requester_id: MEMBER.id,
      recipient_id: OTHER.id,
      status: "pending",
    });
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toContain("extension_requested");
  });

  it("shortens freely and promotes the waitlist", async () => {
    const waiting = reservation({
      id: "bbbbbbbb-0000-4000-8000-000000000003",
      user_id: OTHER.id,
      start_date: "2026-09-16",
      end_date: "2026-09-16",
      status: "waitlisted",
    });
    const res = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine(), waiting] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-09-15",
    });
    expect(res.status).toBe(200);
    expect(res.body.change).toBe("shortened");
    expect(res.tables.fleet_reservations[0].end_date).toBe("2026-09-15");
    expect(res.tables.fleet_reservations[1].status).toBe("reserved");
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toContain("shortened");
  });

  it("refuses the same dates, a span past the maximum, and a last day beyond the horizon", async () => {
    const same = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-09-16",
    });
    expect(same.status).toBe(400);

    // 2026-09-14 to 2026-12-06 is exactly 84 days; one more is too many.
    const tooLong = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-12-07",
    });
    expect(tooLong.status).toBe(409);
    expect(String(tooLong.body.error)).toContain("84");

    // A provisional score books 56 days ahead: 2026-11-09 is the last allowed day.
    const far = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-11-10",
    });
    expect(far.status).toBe(409);
    expect(String(far.body.error)).toContain("(75)");
    expect(far.tables.fleet_reservations[0].end_date).toBe("2026-09-16");
  });

  it("is the owner's (or an admin's) to do", async () => {
    const stranger = await post(asOther({ fleet_assets: unit(), fleet_reservations: [mine()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-09-18",
    });
    expect(stranger.status).toBe(403);

    const admin = await post(
      { viewer: ADMIN, users: [ADMIN, MEMBER], adminEmails: [ADMIN.email!], tables: { fleet_assets: unit(), fleet_reservations: [mine()] } },
      { action: "change_dates", reservation_id: MINE, end_date: "2026-09-18" },
    );
    expect(admin.status).toBe(200);
  });
});

describe("answering an extension request", () => {
  const tables = (extra: Tables = {}): Tables => ({
    fleet_assets: unit(),
    fleet_reservations: [mine(), theirs()],
    fleet_booking_requests: [pendingRequest()],
    ...extra,
  });

  it("is the next booker's to answer, not the requester's or a stranger's", async () => {
    const res = await post(asMember(tables()), { action: "respond_request", request_id: REQUEST, reply: "decline" });
    expect(res.status).toBe(403);
    expect(res.tables.fleet_booking_requests[0].status).toBe("pending");
  });

  it("decline: records the answer and moves nobody", async () => {
    const res = await post(asOther(tables()), { action: "respond_request", request_id: REQUEST, reply: "decline" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.tables.fleet_booking_requests[0]).toMatchObject({ status: "declined", resolved_by: OTHER.id });
    expect(res.tables.fleet_reservations[0].end_date).toBe("2026-09-16");
    expect(res.tables.fleet_reservations[1].start_date).toBe("2026-09-17");
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toContain("extension_resolved");
  });

  it("shorten: the next booking starts the day after, and the extension applies", async () => {
    const res = await post(asOther(tables()), { action: "respond_request", request_id: REQUEST, reply: "shorten" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    const [myRow, theirRow] = res.tables.fleet_reservations;
    expect(theirRow.start_date).toBe("2026-09-19");
    expect(theirRow.status).toBe("reserved");
    expect(myRow.end_date).toBe("2026-09-18");
    expect(res.tables.fleet_booking_requests[0]).toMatchObject({ status: "accepted", resolution: "shorten" });
    const kinds = res.tables.fleet_asset_events.map((e) => e.kind);
    expect(kinds).toContain("shortened");
    expect(kinds).toContain("extended");
  });

  it("cancel: the next booking is cancelled (unscored) and the extension applies", async () => {
    const res = await post(asOther(tables()), { action: "respond_request", request_id: REQUEST, reply: "cancel" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    const [myRow, theirRow] = res.tables.fleet_reservations;
    expect(theirRow).toMatchObject({ status: "cancelled", closed_reason: "cancelled" });
    expect(myRow.end_date).toBe("2026-09-18");
    expect(res.tables.fleet_booking_requests[0]).toMatchObject({ status: "accepted", resolution: "cancel" });
  });

  it("refuses to shorten a booking the extension would swallow whole", async () => {
    const res = await post(
      asOther(tables({ fleet_reservations: [mine(), theirs({ end_date: "2026-09-18" })] })),
      { action: "respond_request", request_id: REQUEST, reply: "shorten" },
    );
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/cancel it instead/i);
    expect(res.tables.fleet_booking_requests[0].status).toBe("pending");
  });

  it("waits for every colliding booking before extending", async () => {
    const third = reservation({
      id: "bbbbbbbb-0000-4000-8000-000000000004",
      user_id: ADMIN.id,
      start_date: "2026-09-20",
      end_date: "2026-09-21",
      status: "reserved",
    });
    const second = pendingRequest({
      id: "cccccccc-0000-4000-8000-000000000002",
      target_reservation_id: third.id,
      recipient_id: ADMIN.id,
      requested_end_date: "2026-09-21",
    });
    const res = await post(
      {
        viewer: OTHER,
        users: [MEMBER, OTHER, ADMIN],
        tables: {
          fleet_assets: unit(),
          fleet_reservations: [mine(), theirs(), third],
          fleet_booking_requests: [pendingRequest({ requested_end_date: "2026-09-21" }), second],
        },
      },
      { action: "respond_request", request_id: REQUEST, reply: "cancel" },
    );
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.waiting_on).toBe(1);
    expect(res.tables.fleet_reservations[0].end_date).toBe("2026-09-16");
  });

  it("a target with no account behind it is an admin's to answer", async () => {
    const unclaimed = tables({
      fleet_reservations: [mine(), theirs({ user_id: null, holder_label: "Charles" })],
      fleet_booking_requests: [pendingRequest({ recipient_id: null })],
    });
    const other = await post(asOther(unclaimed), { action: "respond_request", request_id: REQUEST, reply: "cancel" });
    expect(other.status).toBe(403);

    const admin = await post(
      { viewer: ADMIN, users: [ADMIN, MEMBER], adminEmails: [ADMIN.email!], tables: unclaimed },
      { action: "respond_request", request_id: REQUEST, reply: "cancel" },
    );
    expect(admin.status).toBe(200);
    expect(admin.tables.fleet_reservations[0].end_date).toBe("2026-09-18");
  });

  it("lapses once the next booking has started", async () => {
    const res = await post(asOther(tables({ fleet_reservations: [mine(), theirs({ start_date: "2026-09-14" })] })), {
      action: "respond_request",
      request_id: REQUEST,
      reply: "shorten",
    });
    expect(res.status).toBe(409);
    expect(res.tables.fleet_booking_requests[0].status).toBe("expired");
  });

  it("cannot be answered twice", async () => {
    const res = await post(asOther(tables({ fleet_booking_requests: [pendingRequest({ status: "declined" })] })), {
      action: "respond_request",
      request_id: REQUEST,
      reply: "cancel",
    });
    expect(res.status).toBe(409);
  });
});

describe("requests settle when the bookings around them change", () => {
  it("withdraws my request when I cancel or check in", async () => {
    const res = await post(
      asMember({ fleet_assets: unit(), fleet_reservations: [mine(), theirs()], fleet_booking_requests: [pendingRequest()] }),
      { action: "check_in", reservation_id: MINE },
    );
    expect(res.status).toBe(200);
    expect(res.tables.fleet_booking_requests[0].status).toBe("cancelled");
  });

  it("expires a request once the next booker has picked the unit up", async () => {
    const res = await post(
      asOther({
        fleet_assets: [pooledAsset()],
        fleet_reservations: [mine({ status: "returned", returned_on: "2026-09-14", closed_reason: "returned" }), theirs({ start_date: "2026-09-14" })],
        fleet_booking_requests: [pendingRequest()],
      }),
      { action: "check_out", reservation_id: THEIRS },
    );
    expect(res.status).toBe(200);
    expect(res.tables.fleet_booking_requests[0].status).toBe("expired");
  });

  it("shows each side their own requests on the board", async () => {
    const { get } = await import("@/test/fleet-harness");
    const seed = { fleet_assets: unit(), fleet_reservations: [mine(), theirs()], fleet_booking_requests: [pendingRequest()] };
    const asker = await get(asMember(seed));
    const askerRequests = asker.body.requests as Array<Record<string, unknown>>;
    expect(askerRequests).toHaveLength(1);
    expect(askerRequests[0]).toMatchObject({ outgoing: true, incoming: false, recipient_name: expect.any(String) });

    const answerer = await get(asOther(seed));
    const theirRequests = answerer.body.requests as Array<Record<string, unknown>>;
    expect(theirRequests[0]).toMatchObject({ incoming: true, outgoing: false, asset_name: "SVA-257" });
  });
});
