import { describe, expect, it } from "vitest";
import type { Tables } from "@/test/fake-supabase";
import { ADMIN, ASSET_ID, MEMBER, OTHER, pooledAsset, post, reservation, RESERVATION_ID } from "@/test/fleet-harness";

/**
 * Interchangeable units (fleet edge cases, phase 4, revised 2026-10-19 to go
 * by type): the reserve refusal offers free units of the same type, and
 * `move_booking` takes one.
 *
 * Clock frozen at 2026-09-14. SVA-257 (ASSET_ID) and SVA-330 (SIBLING) are
 * both drones; REV-7 is a LiDAR.
 */

const SIBLING = "aaaaaaaa-0000-4000-8000-000000000002";
const OTHER_KIND = "aaaaaaaa-0000-4000-8000-000000000003";
const MINE = RESERVATION_ID;
const THEIRS = "bbbbbbbb-0000-4000-8000-000000000002";
const REQUEST = "cccccccc-0000-4000-8000-000000000001";

const fleet = (extra: { sibling?: Record<string, unknown> } = {}) => [
  pooledAsset(),
  pooledAsset({ id: SIBLING, name: "SVA-330", current_location: "Basel", ...extra.sibling }),
  pooledAsset({ id: OTHER_KIND, name: "REV-7", category: "lidar", model: "LiDAR Rev 7" }),
];

const asMember = (tables: Tables) => ({ viewer: MEMBER, users: [MEMBER, OTHER], tables });
const asOther = (tables: Tables) => ({ viewer: OTHER, users: [MEMBER, OTHER], tables });

describe("a clash offers free units of the same type", () => {
  const clash = { action: "reserve", asset_id: ASSET_ID, start_date: "2026-09-15", end_date: "2026-09-17" };

  it("names the sibling that is free, and only that one", async () => {
    const res = await post(asOther({ fleet_assets: fleet(), fleet_reservations: [reservation()] }), clash);
    expect(res.status).toBe(409);
    expect(res.body.alternatives).toEqual([{ asset_id: SIBLING, name: "SVA-330", location: "Basel", assigned: false, holder: null }]);
    expect(String(res.body.error)).toMatch(/SVA-330 is free for those days/);
  });

  it("offers nothing when the sibling is taken, in repair, or of another type", async () => {
    const siblingTaken = await post(
      asOther({
        fleet_assets: fleet(),
        fleet_reservations: [reservation(), reservation({ id: THEIRS, asset_id: SIBLING, user_id: ADMIN.id, start_date: "2026-09-17", end_date: "2026-09-17" })],
      }),
      clash,
    );
    expect(siblingTaken.body.alternatives).toEqual([]);
    expect(String(siblingTaken.body.error)).toMatch(/waitlist/i);

    const inRepair = await post(asOther({ fleet_assets: fleet({ sibling: { status: "in_repair" } }), fleet_reservations: [reservation()] }), clash);
    expect(inRepair.body.alternatives).toEqual([]);

    const otherType = await post(asOther({ fleet_assets: [pooledAsset(), pooledAsset({ id: SIBLING, name: "REV-7", category: "lidar" })], fleet_reservations: [reservation()] }), clash);
    expect(otherType.body.alternatives).toEqual([]);
  });

  it("lets the person book the sibling for the same days", async () => {
    const res = await post(asOther({ fleet_assets: fleet(), fleet_reservations: [reservation()] }), { ...clash, asset_id: SIBLING });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations.filter((r) => r.asset_id === SIBLING)).toHaveLength(1);
  });
});

describe("moving a booking to a sibling", () => {
  const mine = (extra: Record<string, unknown> = {}) =>
    reservation({ status: "reserved", start_date: "2026-09-17", end_date: "2026-09-19", ...extra });

  it("moves the same days onto the free unit and records it on both", async () => {
    const res = await post(asMember({ fleet_assets: fleet(), fleet_reservations: [mine()] }), {
      action: "move_booking",
      reservation_id: MINE,
      asset_id: SIBLING,
    });
    expect(res.status).toBe(200);
    expect(res.body.moved_to).toBe(SIBLING);
    const row = res.tables.fleet_reservations[0];
    expect(row).toMatchObject({ asset_id: SIBLING, start_date: "2026-09-17", end_date: "2026-09-19", status: "reserved" });
    const moves = res.tables.fleet_asset_events.filter((e) => e.kind === "moved_booking");
    expect(moves.map((e) => e.asset_id).sort()).toEqual([ASSET_ID, SIBLING].sort());
  });

  it("is the owner's to do, before pick-up, onto a free unit", async () => {
    const stranger = await post(asOther({ fleet_assets: fleet(), fleet_reservations: [mine()] }), { action: "move_booking", reservation_id: MINE, asset_id: SIBLING });
    expect(stranger.status).toBe(403);

    const inHand = await post(
      asMember({ fleet_assets: fleet(), fleet_reservations: [mine({ status: "picked_up", start_date: "2026-09-14" })] }),
      { action: "move_booking", reservation_id: MINE, asset_id: SIBLING },
    );
    expect(inHand.status).toBe(409);
    expect(String(inHand.body.error)).toMatch(/in your hands/i);

    const taken = await post(
      asMember({
        fleet_assets: fleet(),
        fleet_reservations: [mine(), reservation({ id: THEIRS, asset_id: SIBLING, user_id: OTHER.id, start_date: "2026-09-18", end_date: "2026-09-18" })],
      }),
      { action: "move_booking", reservation_id: MINE, asset_id: SIBLING },
    );
    expect(taken.status).toBe(409);
    expect(taken.tables.fleet_reservations[0].asset_id).toBe(ASSET_ID);
  });

  it("grants the extension request that was waiting on the moved booking", async () => {
    // MEMBER holds SVA-257 14–16 and asked to keep it until the 18th; OTHER
    // has it 17–19 and moves to SVA-330 instead.
    const holder = reservation({ status: "picked_up", start_date: "2026-09-14", end_date: "2026-09-16" });
    const theirs = reservation({ id: THEIRS, user_id: OTHER.id, start_date: "2026-09-17", end_date: "2026-09-19", status: "reserved" });
    const request = {
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
    };
    const res = await post(
      asOther({
        fleet_assets: fleet().map((a) => (a.id === ASSET_ID ? { ...a, status: "out", current_holder_user_id: MEMBER.id } : a)),
        fleet_reservations: [holder, theirs],
        fleet_booking_requests: [request],
      }),
      { action: "move_booking", reservation_id: THEIRS, asset_id: SIBLING },
    );
    expect(res.status).toBe(200);
    expect(res.body.granted).toEqual([MINE]);
    expect(res.tables.fleet_booking_requests[0]).toMatchObject({ status: "accepted", resolution: "move" });
    expect(res.tables.fleet_reservations[0].end_date).toBe("2026-09-18");
    expect(res.tables.fleet_reservations[1].asset_id).toBe(SIBLING);
    expect(res.tables.fleet_notice_sends.map((n) => n.kind)).toContain("extension_accepted");
  });

  it("shows the recipient the move as an answer on the board", async () => {
    const { get } = await import("@/test/fleet-harness");
    const holder = reservation({ status: "picked_up", start_date: "2026-09-14", end_date: "2026-09-16" });
    const theirs = reservation({ id: THEIRS, user_id: OTHER.id, start_date: "2026-09-17", end_date: "2026-09-19", status: "reserved" });
    const request = {
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
    };
    const res = await get(asOther({ fleet_assets: fleet(), fleet_reservations: [holder, theirs], fleet_booking_requests: [request] }));
    const [view] = res.body.requests as Array<{ incoming: boolean; alternatives: Array<{ name: string }> }>;
    expect(view.incoming).toBe(true);
    expect(view.alternatives.map((a) => a.name)).toEqual(["SVA-330"]);
  });
});

describe("there is nothing to set for interchangeability", () => {
  it("ignores a kind_key an old client might still send", async () => {
    const res = await post(
      { viewer: ADMIN, adminEmails: [ADMIN.email!], tables: { fleet_assets: [], fleet_reservations: [] } },
      { action: "create_asset", name: "SVA-900", category: "drone", kind_key: "Elios 3" },
    );
    expect(res.status).toBe(200);
    expect(res.tables.fleet_assets[0]).not.toHaveProperty("kind_key");
  });
});
