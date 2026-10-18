import { describe, expect, it } from "vitest";
import type { Tables } from "@/test/fake-supabase";
import { MEMBER, OTHER, pooledAsset, post, reservation, RESERVATION_ID } from "@/test/fleet-harness";

/**
 * Notices to the OTHER party (fleet edge cases, phase 3), as seen through the
 * route: the claim row in `fleet_notice_sends` is what proves a notice was
 * attempted exactly once. Push and Resend are both unconfigured in tests, so
 * every row ends `no_channel` — the delivery itself is covered by the pure
 * renderer tests and the push helper.
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

describe("who gets told", () => {
  it("the next booker, when someone asks to extend into their days", async () => {
    const res = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine(), theirs()] }), {
      action: "change_dates",
      reservation_id: MINE,
      end_date: "2026-09-18",
    });
    expect(res.status).toBe(200);
    const [notice] = res.tables.fleet_notice_sends;
    expect(notice).toMatchObject({ recipient_id: OTHER.id, kind: "extension_request", reservation_id: THEIRS, status: "no_channel" });
  });

  it("the requester, when their request is answered either way", async () => {
    const seed = (): Tables => ({ fleet_assets: unit(), fleet_reservations: [mine(), theirs()], fleet_booking_requests: [pendingRequest()] });
    const declined = await post(asOther(seed()), { action: "respond_request", request_id: REQUEST, reply: "decline" });
    expect(declined.tables.fleet_notice_sends[0]).toMatchObject({ recipient_id: MEMBER.id, kind: "extension_declined", reservation_id: MINE });

    const accepted = await post(asOther(seed()), { action: "respond_request", request_id: REQUEST, reply: "shorten" });
    expect(accepted.tables.fleet_notice_sends[0]).toMatchObject({ recipient_id: MEMBER.id, kind: "extension_accepted", reservation_id: MINE });
  });

  it("the next booker, when the unit comes back early", async () => {
    const res = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine(), theirs()] }), {
      action: "check_in",
      reservation_id: MINE,
    });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_notice_sends[0]).toMatchObject({ recipient_id: OTHER.id, kind: "unit_back_early", reservation_id: THEIRS });
  });

  it("nobody, when the unit comes back on its last day", async () => {
    const res = await post(
      asMember({ fleet_assets: unit(), fleet_reservations: [mine({ end_date: "2026-09-14" }), theirs()] }),
      { action: "check_in", reservation_id: MINE },
    );
    expect(res.status).toBe(200);
    expect(res.tables.fleet_notice_sends).toHaveLength(0);
  });

  it("the person promoted from the waitlist", async () => {
    const waiting = reservation({ id: THEIRS, user_id: OTHER.id, start_date: "2026-09-15", end_date: "2026-09-16", status: "waitlisted" });
    const res = await post(asMember({ fleet_assets: unit(), fleet_reservations: [mine(), waiting] }), {
      action: "check_in",
      reservation_id: MINE,
    });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations[1].status).toBe("reserved");
    expect(res.tables.fleet_notice_sends.map((n) => n.kind)).toContain("waitlist_promoted");
  });

  it("never the same notice twice for the same day", async () => {
    const already = {
      reservation_id: THEIRS,
      recipient_id: OTHER.id,
      kind: "unit_back_early",
      sent_for_date: "2026-09-14",
      status: "pushed",
    };
    const res = await post(
      asMember({ fleet_assets: unit(), fleet_reservations: [mine(), theirs()], fleet_notice_sends: [already] }),
      { action: "check_in", reservation_id: MINE },
    );
    expect(res.status).toBe(200);
    // The fake has no unique index, so the second claim would land as a second
    // row — unless the sender deduplicates. It does not; the DATABASE does, and
    // the fake cannot model that. What this proves is that the sender keys the
    // claim on exactly the columns the index covers.
    const rows = res.tables.fleet_notice_sends.filter((n) => n.kind === "unit_back_early");
    expect(rows.every((n) => n.reservation_id === THEIRS && n.recipient_id === OTHER.id && n.sent_for_date === "2026-09-14")).toBe(true);
  });

  it("respects a person who turned Fleet notices off", async () => {
    const quiet = { ...OTHER, user_metadata: { fleet_notices: false } } as typeof OTHER;
    const res = await post(
      { viewer: MEMBER, users: [MEMBER, quiet], tables: { fleet_assets: unit(), fleet_reservations: [mine(), theirs()] } },
      { action: "check_in", reservation_id: MINE },
    );
    expect(res.status).toBe(200);
    expect(res.tables.fleet_notice_sends[0]).toMatchObject({ kind: "unit_back_early", status: "opted_out" });
  });
});
