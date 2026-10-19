import { NextResponse } from "next/server";
import { recordAssetEvent } from "@/lib/fleet-queries";
import { FLEET_HOME_LOCATION } from "@/lib/fleet-rules";
import { closeLiveReservations, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

/**
 * Puts an assigned unit back into the shared pool: it becomes bookable and
 * reappears in the calendar. Closes whatever open booking was holding it.
 *
 * Admin only, as the mirror of `assign`. Without the guard any signed-in user
 * could name any asset and force-close someone else's live booking — and a
 * booking closed as `returned` past its due date is scored as a late return, so
 * an open endpoint here is also a way to damage another person's reliability.
 */
export async function handleReturnToPool(
  ctx: FleetActionContext,
  payload: FleetPayload<"return_to_pool">,
): Promise<NextResponse> {
  const { admin, viewer } = ctx;
  if (!viewer.isAdmin) {
    return NextResponse.json(
      { error: "Only admins can return material to the shared pool." },
      { status: 403 },
    );
  }

  const { data: asset, error: readError } = await admin
    .from("fleet_assets")
    .select("id, name, current_location")
    .eq("id", payload.asset_id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  const landingSpot = payload.location ?? FLEET_HOME_LOCATION;

  await closeLiveReservations(admin, payload.asset_id);

  const { error: assetError } = await admin
    .from("fleet_assets")
    .update({
      pooled: true,
      status: "available",
      current_holder_user_id: null,
      current_holder_label: null,
      current_location: landingSpot,
      location_confirmed_at: new Date().toISOString(),
    })
    .eq("id", payload.asset_id);
  if (assetError) throw new Error(assetError.message);

  await recordAssetEvent(admin, {
    asset_id: payload.asset_id,
    kind: "checked_in",
    actor_user_id: viewer.id,
    from_location: asset.current_location,
    to_location: landingSpot,
    note: `Returned to the bookable pool${payload.note ? ` — ${payload.note}` : ""}`,
  });

  return NextResponse.json({ ok: true, message: `${asset.name} is back in the pool and bookable.` });
}
