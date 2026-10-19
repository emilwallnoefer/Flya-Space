import { describe, expect, it } from "vitest";
import type { Tables } from "@/test/fake-supabase";
import {
  ADMIN,
  ASSET_ID,
  ASSIGNED_ID,
  ASSIGNMENT_ID,
  assignedAsset,
  assignmentRow,
  get,
  MEMBER,
  OTHER,
  pooledAsset,
  post,
  reservation,
  RESERVATION_ID,
} from "@/test/fleet-harness";

/**
 * Borrowing assigned material (fleet edge cases, section D revised 2026-10-19).
 *
 * Clock frozen at 2026-09-14. SVA-257 (ASSET_ID) is pooled; SVA-412
 * (ASSIGNED_ID) is assigned to "Charles" — a name with no account until a test
 * says otherwise — with the open assignment booking 1 Sep – 1 Oct behind it.
 */

const PENDING = "bbbbbbbb-0000-4000-8000-000000000031";
const REQUEST = "cccccccc-0000-4000-8000-000000000031";

const fleet = (assigned: Record<string, unknown> = {}) => [pooledAsset(), assignedAsset(assigned)];
const asMember = (tables: Tables) => ({ viewer: MEMBER, users: [MEMBER, OTHER, ADMIN], adminEmails: [ADMIN.email!], tables });
const asOther = (tables: Tables) => ({ viewer: OTHER, users: [MEMBER, OTHER, ADMIN], adminEmails: [ADMIN.email!], tables });
const asAdmin = (tables: Tables) => ({ viewer: ADMIN, users: [MEMBER, OTHER, ADMIN], adminEmails: [ADMIN.email!], tables });

/** MEMBER's pending borrow of SVA-412 for 15–16 Sep, with its request. */
const pendingBorrow = (extra: { recipient?: string | null } = {}) => ({
  booking: reservation({ id: PENDING, asset_id: ASSIGNED_ID, start_date: "2026-09-15", end_date: "2026-09-16", status: "waitlisted" }),
  request: {
    id: REQUEST,
    kind: "borrow",
    reservation_id: PENDING,
    target_reservation_id: null,
    asset_id: ASSIGNED_ID,
    requested_start_date: "2026-09-15",
    requested_end_date: "2026-09-16",
    requester_id: MEMBER.id,
    recipient_id: extra.recipient === undefined ? null : extra.recipient,
    holder_label: "Charles",
    status: "pending",
    resolution: null,
    created_at: "2026-09-14T08:00:00.000Z",
    resolved_at: null,
  },
});

describe("a clash also offers the assigned units of the type", () => {
  const clash = { action: "reserve", asset_id: ASSET_ID, start_date: "2026-09-15", end_date: "2026-09-16" };

  it("lists the assigned twin after the free ones, as something to ask for", async () => {
    const res = await post(asOther({ fleet_assets: fleet(), fleet_reservations: [reservation({ start_date: "2026-09-15", end_date: "2026-09-16" }), assignmentRow()] }), clash);
    expect(res.status).toBe(409);
    expect(res.body.alternatives).toEqual([{ asset_id: ASSIGNED_ID, name: "SVA-412", location: "Basel", assigned: true, holder: "Charles" }]);
    expect(String(res.body.error)).toMatch(/SVA-412 \(Charles\) is assigned and can be asked for/);
  });

  it("does not offer an assigned unit already lent for those days, or one in repair", async () => {
    const lent = reservation({ id: PENDING, asset_id: ASSIGNED_ID, user_id: ADMIN.id, start_date: "2026-09-16", end_date: "2026-09-16", status: "reserved" });
    const taken = await post(asOther({ fleet_assets: fleet(), fleet_reservations: [reservation({ start_date: "2026-09-15", end_date: "2026-09-16" }), assignmentRow(), lent] }), clash);
    expect(taken.body.alternatives).toEqual([]);
    const repair = await post(asOther({ fleet_assets: fleet({ status: "in_repair" }), fleet_reservations: [reservation({ start_date: "2026-09-15", end_date: "2026-09-16" })] }), clash);
    expect(repair.body.alternatives).toEqual([]);
  });
});

describe("asking for an assigned unit", () => {
  const ask = { action: "reserve", asset_id: ASSIGNED_ID, start_date: "2026-09-15", end_date: "2026-09-16", destination: "Zurich" };

  it("files a pending booking and a request to the admins when the assignee has no account", async () => {
    const res = await post(asMember({ fleet_assets: fleet(), fleet_reservations: [assignmentRow()] }), ask);
    expect(res.status).toBe(200);
    expect(res.body.requested).toBe(true);
    expect(String(res.body.message)).toMatch(/assigned to Charles/);
    expect(String(res.body.message)).toMatch(/nothing is booked until they approve/i);

    const booking = res.tables.fleet_reservations.find((r) => r.id !== ASSIGNMENT_ID)!;
    expect(booking).toMatchObject({ asset_id: ASSIGNED_ID, user_id: MEMBER.id, status: "waitlisted", start_date: "2026-09-15", end_date: "2026-09-16", destination: "Zurich" });
    // The assignment itself is untouched until approval.
    expect(res.tables.fleet_reservations.find((r) => r.id === ASSIGNMENT_ID)).toMatchObject({ status: "picked_up", end_date: "2026-10-01" });

    const [request] = res.tables.fleet_booking_requests;
    expect(request).toMatchObject({
      kind: "borrow",
      reservation_id: booking.id,
      asset_id: ASSIGNED_ID,
      requested_start_date: "2026-09-15",
      requested_end_date: "2026-09-16",
      requester_id: MEMBER.id,
      recipient_id: null,
      holder_label: "Charles",
      status: "pending",
    });
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toContain("borrow_requested");
    // Nobody has claimed "Charles", so the admins are asked.
    expect(res.tables.fleet_notice_sends.map((n) => [n.kind, n.recipient_id])).toEqual([["borrow_request", ADMIN.id]]);
  });

  it("asks the assignee themselves when they have an account", async () => {
    const res = await post(
      asMember({ fleet_assets: fleet({ current_holder_user_id: OTHER.id }), fleet_reservations: [assignmentRow({ user_id: OTHER.id })] }),
      ask,
    );
    expect(res.status).toBe(200);
    expect(res.tables.fleet_booking_requests[0].recipient_id).toBe(OTHER.id);
    expect(res.tables.fleet_notice_sends.map((n) => n.recipient_id)).toEqual([OTHER.id]);
    expect(String(res.body.message)).toMatch(/assigned to Otto Other/);
  });

  it("is refused for days already lent to someone else, and for a retired unit", async () => {
    const lent = reservation({ id: PENDING, asset_id: ASSIGNED_ID, user_id: OTHER.id, start_date: "2026-09-16", end_date: "2026-09-17", status: "reserved" });
    const taken = await post(asMember({ fleet_assets: fleet(), fleet_reservations: [assignmentRow(), lent] }), ask);
    expect(taken.status).toBe(409);
    expect(String(taken.body.error)).toMatch(/already booked/);
    expect(taken.tables.fleet_booking_requests).toHaveLength(0);

    const retired = await post(asMember({ fleet_assets: fleet({ status: "retired" }), fleet_reservations: [assignmentRow()] }), ask);
    expect(retired.status).toBe(409);
    expect(String(retired.body.error)).toMatch(/retired/);
  });

  it("shows the requester 'awaiting approval' rather than a waitlist spot, and admins the question", async () => {
    const { booking, request } = pendingBorrow();
    const mine = await get(asMember({ fleet_assets: fleet(), fleet_reservations: [assignmentRow(), booking], fleet_booking_requests: [request] }));
    const [view] = mine.body.requests as Array<Record<string, unknown>>;
    expect(view).toMatchObject({ kind: "borrow", outgoing: true, incoming: false, recipient_name: "Charles", target_start_date: "2026-09-15", target_end_date: "2026-09-16", asset_name: "SVA-412" });
    const rows = mine.body.reservations as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.id === PENDING)).toMatchObject({ status: "waitlisted", is_mine: true });

    const admins = await get(asAdmin({ fleet_assets: fleet(), fleet_reservations: [assignmentRow(), booking], fleet_booking_requests: [request] }));
    const [forAdmin] = admins.body.requests as Array<Record<string, unknown>>;
    expect(forAdmin).toMatchObject({ kind: "borrow", incoming: true });
  });
});

describe("answering a borrow request", () => {
  const seed = (extra: { recipient?: string | null } = {}) => {
    const { booking, request } = pendingBorrow(extra);
    return { fleet_assets: fleet(extra.recipient ? { current_holder_user_id: extra.recipient } : {}), fleet_reservations: [assignmentRow(), booking], fleet_booking_requests: [request] };
  };

  it("is the assignee's (or an admin's) to answer, with approve or decline only", async () => {
    const stranger = await post(asOther(seed()), { action: "respond_request", request_id: REQUEST, reply: "approve" });
    expect(stranger.status).toBe(403);
    const requester = await post(asMember(seed()), { action: "respond_request", request_id: REQUEST, reply: "approve" });
    expect(requester.status).toBe(403);
    const wrongReply = await post(asAdmin(seed()), { action: "respond_request", request_id: REQUEST, reply: "shorten" });
    expect(wrongReply.status).toBe(400);
    const extensionApprove = await post(
      asOther({
        fleet_assets: [pooledAsset()],
        fleet_reservations: [reservation({ status: "picked_up" }), reservation({ id: PENDING, user_id: OTHER.id, start_date: "2026-09-17", end_date: "2026-09-19" })],
        fleet_booking_requests: [{ id: REQUEST, kind: "extension", reservation_id: RESERVATION_ID, target_reservation_id: PENDING, requested_end_date: "2026-09-18", requester_id: MEMBER.id, recipient_id: OTHER.id, status: "pending", resolution: null, created_at: "2026-09-14T08:00:00.000Z", resolved_at: null }],
      }),
      { action: "respond_request", request_id: REQUEST, reply: "approve" },
    );
    expect(extensionApprove.status).toBe(400);
  });

  it("approve books it and ends the assignment's booking the day before", async () => {
    const res = await post(asOther(seed({ recipient: OTHER.id })), { action: "respond_request", request_id: REQUEST, reply: "approve" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("approved");
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)).toMatchObject({ status: "reserved" });
    expect(res.tables.fleet_reservations.find((r) => r.id === ASSIGNMENT_ID)).toMatchObject({ status: "picked_up", end_date: "2026-09-14" });
    expect(res.tables.fleet_booking_requests[0]).toMatchObject({ status: "accepted", resolution: "approve", resolved_by: OTHER.id });
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toEqual(expect.arrayContaining(["borrow_resolved", "reserved"]));
    expect(res.tables.fleet_notice_sends.map((n) => [n.kind, n.recipient_id])).toEqual([["borrow_approved", MEMBER.id]]);
  });

  it("an admin approves for an assignee with no account", async () => {
    const res = await post(asAdmin(seed()), { action: "respond_request", request_id: REQUEST, reply: "approve" });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)!.status).toBe("reserved");
  });

  it("refuses to approve days that were lent to someone else meanwhile", async () => {
    const tables = seed();
    tables.fleet_reservations.push(reservation({ id: "bbbbbbbb-0000-4000-8000-000000000032", asset_id: ASSIGNED_ID, user_id: OTHER.id, start_date: "2026-09-16", end_date: "2026-09-16", status: "reserved" }));
    const res = await post(asAdmin(tables), { action: "respond_request", request_id: REQUEST, reply: "approve" });
    expect(res.status).toBe(409);
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)!.status).toBe("waitlisted");
    expect(res.tables.fleet_booking_requests[0].status).toBe("pending");
  });

  it("decline cancels the pending booking and tells the requester", async () => {
    const res = await post(asAdmin(seed()), { action: "respond_request", request_id: REQUEST, reply: "decline" });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)).toMatchObject({ status: "cancelled", closed_reason: "cancelled" });
    expect(res.tables.fleet_reservations.find((r) => r.id === ASSIGNMENT_ID)).toMatchObject({ status: "picked_up", end_date: "2026-10-01" });
    expect(res.tables.fleet_booking_requests[0].status).toBe("declined");
    expect(res.tables.fleet_notice_sends.map((n) => n.kind)).toEqual(["borrow_declined"]);
  });

  it("withdrawing the pending booking withdraws the question", async () => {
    const res = await post(asMember(seed()), { action: "cancel", reservation_id: PENDING });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_booking_requests[0].status).toBe("cancelled");
    // Never promoted: a waitlisted row on an assigned unit is not a queue.
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)!.status).toBe("cancelled");
  });
});

describe("a borrowed unit changes hands and comes back", () => {
  // Approved: MEMBER has SVA-412 booked 14–16 Sep; the assignment stopped on the 13th.
  const approved = (): Tables => ({
    fleet_assets: fleet(),
    fleet_reservations: [
      assignmentRow({ end_date: "2026-09-13" }),
      reservation({ id: PENDING, asset_id: ASSIGNED_ID, start_date: "2026-09-14", end_date: "2026-09-16", status: "reserved" }),
    ],
    fleet_booking_requests: [{ ...pendingBorrow().request, status: "accepted", resolution: "approve", requested_start_date: "2026-09-14" }],
  });

  it("the borrower picks it up from the assignee — the unit being 'out' is not a refusal here", async () => {
    const res = await post(asMember(approved()), { action: "check_out", reservation_id: PENDING });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)!.status).toBe("picked_up");
    expect(res.tables.fleet_reservations.find((r) => r.id === ASSIGNMENT_ID)).toMatchObject({ status: "returned", closed_reason: "returned", returned_on: "2026-09-14" });
    expect(res.tables.fleet_assets.find((a) => a.id === ASSIGNED_ID)).toMatchObject({ status: "out", current_holder_user_id: MEMBER.id, current_holder_label: null, pooled: false });
  });

  it("a pooled unit still out with someone else is still refused", async () => {
    const res = await post(
      asOther({
        fleet_assets: [pooledAsset({ status: "out", current_holder_user_id: MEMBER.id })],
        fleet_reservations: [reservation({ status: "picked_up", start_date: "2026-09-10", end_date: "2026-09-12" }), reservation({ id: PENDING, user_id: OTHER.id, start_date: "2026-09-14", end_date: "2026-09-15" })],
      }),
      { action: "check_out", reservation_id: PENDING },
    );
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/still out with Mel Member/);
  });

  it("bringing it back puts it with the assignee again and re-opens their booking", async () => {
    const tables = approved();
    tables.fleet_reservations[1] = { ...tables.fleet_reservations[1], status: "picked_up", picked_up_at: "2026-09-14T08:00:00.000Z" };
    tables.fleet_reservations[0] = { ...tables.fleet_reservations[0], status: "returned", closed_reason: "returned", returned_on: "2026-09-14" };
    tables.fleet_assets[1] = { ...tables.fleet_assets[1], current_holder_user_id: MEMBER.id, current_holder_label: null, current_location: "Zurich" };

    const res = await post(asMember(tables), { action: "check_in", reservation_id: PENDING, location: "Basel" });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations.find((r) => r.id === PENDING)).toMatchObject({ status: "returned", closed_reason: "returned" });
    const unit = res.tables.fleet_assets.find((a) => a.id === ASSIGNED_ID)!;
    expect(unit).toMatchObject({ status: "out", current_holder_user_id: null, current_holder_label: "Charles", current_location: "Basel", pooled: false });
    const reopened = res.tables.fleet_reservations.filter((r) => r.asset_id === ASSIGNED_ID && r.status === "picked_up");
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ user_id: null, holder_label: "Charles", source: "sheet_import", start_date: "2026-09-14", end_date: "2026-10-14" });
  });

  it("cancelling an approved borrow gives the assignee their days back", async () => {
    const tables = approved();
    tables.fleet_reservations[1] = { ...tables.fleet_reservations[1], start_date: "2026-09-20", end_date: "2026-09-22" };
    tables.fleet_reservations[0] = { ...tables.fleet_reservations[0], end_date: "2026-09-19" };
    const res = await post(asMember(tables), { action: "cancel", reservation_id: PENDING });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations.find((r) => r.id === ASSIGNMENT_ID)).toMatchObject({ status: "picked_up", end_date: "2026-10-14" });
  });
});
