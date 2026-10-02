import { describe, expect, it } from "vitest";
import {
  ADMIN,
  ASSET_ID,
  get,
  HELD,
  MEMBER,
  OTHER,
  pooledAsset,
  post,
  reservation,
  RESERVATION_ID,
  TODAY,
} from "@/test/fleet-harness";

/**
 * Route-level tests for `/api/fleet`.
 *
 * These run the real handlers — real validation, real authorization, real board
 * assembly — against an in-memory database. See `src/test/fleet-harness.ts` for
 * what is real and what is faked, and `src/test/fake-supabase.ts` for why the
 * fake throws rather than guesses.
 *
 * The clock is frozen at 2026-09-14, so every date rule below asserts the same
 * thing in a year's time.
 */

const assets = (extra: Record<string, unknown> = {}) => [pooledAsset(extra)];

describe("who is allowed in at all", () => {
  it("refuses a request with no session", async () => {
    const anonymous = { viewer: null, tables: { fleet_assets: assets() } };
    expect((await get(anonymous)).status).toBe(401);
    expect((await post(anonymous, { action: "confirm_location", asset_id: ASSET_ID })).status).toBe(401);
  });

  it("refuses an account still waiting for a role (audit run-4 F3)", async () => {
    // The role gate page used to be the only thing standing here.
    const held = { viewer: HELD, tables: { fleet_assets: assets() } };
    expect((await get(held)).status).toBe(403);
    expect((await post(held, { action: "confirm_location", asset_id: ASSET_ID })).status).toBe(403);
  });

  it("rejects an unknown action and a malformed payload", async () => {
    const base = { viewer: MEMBER, tables: { fleet_assets: assets() } };
    expect((await post(base, { action: "drop_everything" })).status).toBe(400);
    // Right action, wrong shape: asset_id must be a uuid.
    expect((await post(base, { action: "confirm_location", asset_id: "nope" })).status).toBe(400);
  });

  it("rejects a malformed window on a read", async () => {
    const res = await get({ viewer: MEMBER, tables: { fleet_assets: assets() } }, "?start=not-a-date");
    expect(res.status).toBe(400);
  });
});

describe("moving material between the pool and an assignment is admin-only", () => {
  // The gap PR #85 closed: `return_to_pool` had no check at all, and `assign`
  // only guarded against *someone else's* booking.
  const tables = () => ({
    fleet_assets: [pooledAsset({ pooled: false, status: "out", current_holder_label: "Charles" })],
    fleet_reservations: [],
  });

  it("refuses a non-admin", async () => {
    const asMember = { viewer: MEMBER, tables: tables(), adminEmails: [ADMIN.email!] };
    expect((await post(asMember, { action: "return_to_pool", asset_id: ASSET_ID })).status).toBe(403);
    expect(
      (await post(asMember, { action: "assign", asset_id: ASSET_ID, holder_label: "Mel" })).status,
    ).toBe(403);
  });

  it("allows an admin, and actually moves the unit", async () => {
    const asAdmin = { viewer: ADMIN, tables: tables(), adminEmails: [ADMIN.email!] };
    const res = await post(asAdmin, { action: "return_to_pool", asset_id: ASSET_ID });
    expect(res.status).toBe(200);

    const asset = res.tables.fleet_assets[0];
    expect(asset.pooled).toBe(true);
    expect(asset.status).toBe("available");
    expect(asset.current_holder_label).toBeNull();
  });

  it("does not let a non-admin close someone else's booking through it", async () => {
    // The specific damage the missing check allowed: a stranger ending a live
    // booking, which also scored it as a late return against its holder.
    const res = await post(
      {
        viewer: OTHER,
        tables: {
          fleet_assets: assets(),
          fleet_reservations: [reservation({ status: "picked_up", end_date: "2026-09-01" })],
        },
        adminEmails: [ADMIN.email!],
      },
      { action: "return_to_pool", asset_id: ASSET_ID },
    );
    expect(res.status).toBe(403);
    expect(res.tables.fleet_reservations[0].status).toBe("picked_up");
  });
});

describe("managing the fleet list is admin-only", () => {
  const asMember = () => ({
    viewer: MEMBER,
    tables: { fleet_assets: assets() },
    adminEmails: [ADMIN.email!],
  });

  it("refuses a non-admin", async () => {
    expect(
      (await post(asMember(), { action: "create_asset", name: "X", category: "drone" })).status,
    ).toBe(403);
    expect(
      (await post(asMember(), { action: "set_status", asset_id: ASSET_ID, status: "in_repair" })).status,
    ).toBe(403);
    expect((await post(asMember(), { action: "archive_asset", asset_id: ASSET_ID })).status).toBe(403);
  });
});

describe("a booking belongs to the person who made it", () => {
  const tables = () => ({
    fleet_assets: assets(),
    fleet_reservations: [reservation()],
  });
  const RES_ID = RESERVATION_ID;

  it("refuses a stranger", async () => {
    const stranger = { viewer: OTHER, tables: tables(), adminEmails: [ADMIN.email!] };
    expect((await post(stranger, { action: "cancel", reservation_id: RES_ID })).status).toBe(403);
    expect((await post(stranger, { action: "check_out", reservation_id: RES_ID })).status).toBe(403);
    expect((await post(stranger, { action: "check_in", reservation_id: RES_ID })).status).toBe(403);
  });

  it("allows the owner", async () => {
    const owner = { viewer: MEMBER, tables: tables(), adminEmails: [ADMIN.email!] };
    expect((await post(owner, { action: "check_out", reservation_id: RES_ID })).status).toBe(200);
  });

  it("allows an admin to act on anyone's booking", async () => {
    const admin = { viewer: ADMIN, tables: tables(), adminEmails: [ADMIN.email!] };
    expect((await post(admin, { action: "check_out", reservation_id: RES_ID })).status).toBe(200);
  });
});

describe("picking material up and bringing it back", () => {
  const RES_ID = RESERVATION_ID;

  it("check-out marks the unit out and records who has it", async () => {
    const res = await post(
      { viewer: MEMBER, tables: { fleet_assets: assets(), fleet_reservations: [reservation()] } },
      { action: "check_out", reservation_id: RES_ID, location: "Lausanne" },
    );
    expect(res.status).toBe(200);

    expect(res.tables.fleet_reservations[0].status).toBe("picked_up");
    const asset = res.tables.fleet_assets[0];
    expect(asset.status).toBe("out");
    expect(asset.current_holder_user_id).toBe(MEMBER.id);
    expect(asset.current_location).toBe("Lausanne");
    // The movement is on the record, not just the asset row.
    expect(res.tables.fleet_asset_events.map((e) => e.kind)).toContain("checked_out");
  });

  it("check-in returns the unit and stamps the Zurich date", async () => {
    const res = await post(
      {
        viewer: MEMBER,
        tables: {
          fleet_assets: assets({ status: "out", current_holder_user_id: MEMBER.id }),
          fleet_reservations: [reservation({ status: "picked_up" })],
        },
      },
      { action: "check_in", reservation_id: RES_ID },
    );
    expect(res.status).toBe(200);

    const booking = res.tables.fleet_reservations[0];
    expect(booking.status).toBe("returned");
    expect(booking.returned_on).toBe(TODAY);

    const asset = res.tables.fleet_assets[0];
    expect(asset.status).toBe("available");
    expect(asset.current_holder_user_id).toBeNull();
    // Falls back to the home location when the caller names none.
    expect(asset.current_location).toBe("EMEA");
  });

  it("refuses to check out a booking that is not confirmed", async () => {
    const res = await post(
      {
        viewer: MEMBER,
        tables: {
          fleet_assets: assets(),
          fleet_reservations: [reservation({ status: "returned" })],
        },
      },
      { action: "check_out", reservation_id: RES_ID },
    );
    expect(res.status).toBe(409);
  });
});

describe("a return has to follow a pickup (audit run-4 F4)", () => {
  const RES_ID = RESERVATION_ID;

  it("refuses to check in a booking that was never picked up", async () => {
    // The exploit: book today, "return" at once, collect an on-time return.
    const res = await post(
      { viewer: MEMBER, tables: { fleet_assets: assets(), fleet_reservations: [reservation()] } },
      { action: "check_in", reservation_id: RES_ID },
    );
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/never picked up/i);
    // Nothing moved: the booking is still open and no return was scored.
    expect(res.tables.fleet_reservations[0].status).toBe("reserved");
    expect(res.tables.fleet_reservations[0].returned_on ?? null).toBeNull();
  });

  it("does not free a unit that someone else is recorded as holding", async () => {
    // MEMBER's booking is picked up on paper, but the unit is with OTHER.
    const res = await post(
      {
        viewer: MEMBER,
        tables: {
          fleet_assets: assets({ status: "out", current_holder_user_id: OTHER.id, current_location: "Basel" }),
          fleet_reservations: [reservation({ status: "picked_up" })],
        },
      },
      { action: "check_in", reservation_id: RES_ID },
    );
    expect(res.status).toBe(200);
    // MEMBER's own booking closes...
    expect(res.tables.fleet_reservations[0].status).toBe("returned");
    // ...but OTHER still has the unit, where it was.
    const asset = res.tables.fleet_assets[0];
    expect(asset.status).toBe("out");
    expect(asset.current_holder_user_id).toBe(OTHER.id);
    expect(asset.current_location).toBe("Basel");
  });
});

describe("a self-chosen profile name proves nothing (audit run-4 F7)", () => {
  it("does not count a claim on a colleague's name as a self-match", async () => {
    // MEMBER renamed themselves in user_metadata (anyone can, via updateUser)
    // to look like OTHER, then claims OTHER's label.
    const spoofer = {
      ...MEMBER,
      user_metadata: { full_name: "Otto Other" },
    };
    const res = await post(
      {
        viewer: spoofer,
        tables: {
          fleet_assets: assets(),
          fleet_reservations: [reservation({ user_id: null, holder_label: "Otto Other", source: "sheet_import" })],
          fleet_holder_aliases: [],
          fleet_holder_directory: [],
        },
      },
      { action: "claim_holder", label: "Otto Other" },
    );
    expect(res.status).toBe(200);
    // The claim is allowed (permissive by design) but flagged for the admins.
    expect(res.body.self_match).toBe(false);
    expect(res.tables.fleet_holder_aliases[0].self_match).toBe(false);
  });

  it("still recognises a claim on your own provider name", async () => {
    const res = await post(
      {
        viewer: MEMBER,
        tables: {
          fleet_assets: assets(),
          fleet_reservations: [reservation({ user_id: null, holder_label: "Mel Member", source: "sheet_import" })],
          fleet_holder_aliases: [],
          fleet_holder_directory: [],
        },
      },
      { action: "claim_holder", label: "Mel Member" },
    );
    expect(res.status).toBe(200);
    expect(res.body.self_match).toBe(true);
  });
});

describe("only the shared pool can be booked (audit run-4 F5)", () => {
  it("refuses a unit an admin assigned out of the pool", async () => {
    for (const viewer of [MEMBER, ADMIN]) {
      const res = await post(
        {
          viewer,
          adminEmails: [ADMIN.email!],
          tables: {
            fleet_assets: assets({ pooled: false, current_holder_label: "Customer loan: Acme" }),
            fleet_reservations: [],
          },
        },
        { action: "reserve", asset_id: ASSET_ID, start_date: TODAY, end_date: "2026-09-16" },
      );
      expect(res.status).toBe(409);
      expect(String(res.body.error)).toMatch(/not in the shared pool/i);
      expect(res.tables.fleet_reservations).toHaveLength(0);
      // The assignment is untouched.
      expect(res.tables.fleet_assets[0].current_holder_label).toBe("Customer loan: Acme");
    }
  });
});

describe("the booking rules", () => {
  const base = () => ({
    viewer: MEMBER,
    tables: { fleet_assets: assets(), fleet_reservations: [] },
  });

  it("books a free span", async () => {
    const res = await post(base(), {
      action: "reserve",
      asset_id: ASSET_ID,
      start_date: TODAY,
      end_date: "2026-09-16",
    });
    expect(res.status).toBe(200);
    expect(res.tables.fleet_reservations).toHaveLength(1);
    expect(res.tables.fleet_reservations[0].status).toBe("reserved");
  });

  it("refuses a day that is already past", async () => {
    const res = await post(base(), {
      action: "reserve",
      asset_id: ASSET_ID,
      start_date: "2026-09-01",
      end_date: "2026-09-02",
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/already past/i);
  });

  it("refuses a span beyond the horizon a provisional score earns", async () => {
    // No history -> provisional 75 -> "standard" -> 56 days.
    const res = await post(base(), {
      action: "reserve",
      asset_id: ASSET_ID,
      start_date: "2026-12-01",
      end_date: "2026-12-02",
    });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/reliability score/i);
  });

  it("refuses an overlapping span, and offers the waitlist instead", async () => {
    const taken = {
      viewer: OTHER,
      tables: {
        fleet_assets: assets(),
        fleet_reservations: [reservation()], // MEMBER holds 14th-16th
      },
    };
    const clash = {
      action: "reserve",
      asset_id: ASSET_ID,
      start_date: "2026-09-15",
      end_date: "2026-09-17",
    };

    const refused = await post(taken, clash);
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toMatch(/waitlist/i);

    const waitlisted = await post(taken, { ...clash, waitlist: true });
    expect(waitlisted.status).toBe(200);
    expect(waitlisted.body.waitlisted).toBe(true);
    expect(waitlisted.tables.fleet_reservations.map((r) => r.status)).toContain("waitlisted");
  });

  it("refuses to book a unit that is in repair", async () => {
    const res = await post(
      { viewer: MEMBER, tables: { fleet_assets: assets({ status: "in_repair" }), fleet_reservations: [] } },
      { action: "reserve", asset_id: ASSET_ID, start_date: TODAY, end_date: TODAY },
    );
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/in repair/i);
  });
});
