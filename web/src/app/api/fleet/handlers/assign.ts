import { NextResponse } from "next/server";
import { recordAssetEvent, todayInZurich } from "@/lib/fleet-queries";
import { addDays } from "@/lib/fleet-rules";
import { closeLiveReservations, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

/**
 * Takes a unit out of the shared pool and assigns it to someone.
 *
 * Used for the units that are not really shared — a regional demo drone, a
 * customer loan, a unit that lives with one person. It leaves the calendar
 * (nobody can book it) and moves to the Assigned tab.
 *
 * The holder is free text on purpose: the person may have no account, which is
 * exactly the situation the sheet was in. It is recorded as an open booking so
 * the unit still has a check-in path and can be claimed later.
 *
 * Admin only, for the same reason `set_status` is: this takes material off the
 * calendar for everyone and cancels whatever was booked on it. It is reachable
 * only from Fleet -> Manage, which is already an admin-only surface.
 */
export async function handleAssign(
  ctx: FleetActionContext,
  payload: FleetPayload<"assign">,
): Promise<NextResponse> {
  const { admin, viewer } = ctx;
  if (!viewer.isAdmin) {
    return NextResponse.json(
      { error: "Only admins can assign material out of the shared pool." },
      { status: 403 },
    );
  }

  const { data: asset, error: readError } = await admin
    .from("fleet_assets")
    .select("id, name, status, current_location, pooled")
    .eq("id", payload.asset_id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  // An assigned unit travels with its person and nobody logs where; a
  // location on it would be wrong by morning, so it carries none (owner
  // decision, 2026-10-19). The event keeps where it left from.
  const location = null;

  // Every live booking has to go: the unit is leaving the pool, and leaving a
  // reservation pointing at it would strand that person on a date they can no
  // longer use. `closureStatusFor` decides how each one ends, so a booking that
  // was never collected is not filed away as a return.
  await closeLiveReservations(admin, payload.asset_id);

  const today = todayInZurich();
  const { error: insertError } = await admin.from("fleet_reservations").insert({
    asset_id: payload.asset_id,
    user_id: null,
    holder_label: payload.holder_label,
    start_date: today,
    end_date: addDays(today, 30),
    status: "picked_up",
    destination: location,
    source: "sheet_import",
    picked_up_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(insertError.message);

  const { error: assetError } = await admin
    .from("fleet_assets")
    .update({
      pooled: false,
      status: "out",
      current_holder_user_id: null,
      current_holder_label: payload.holder_label,
      current_location: location,
      location_confirmed_at: null,
    })
    .eq("id", payload.asset_id);
  if (assetError) throw new Error(assetError.message);

  await recordAssetEvent(admin, {
    asset_id: payload.asset_id,
    kind: "checked_out",
    actor_user_id: viewer.id,
    from_location: asset.current_location,
    to_location: location,
    note: `Assigned to ${payload.holder_label}${payload.note ? ` — ${payload.note}` : ""}`,
  });

  return NextResponse.json({
    ok: true,
    message: `${asset.name} is now assigned to ${payload.holder_label}.`,
  });
}
