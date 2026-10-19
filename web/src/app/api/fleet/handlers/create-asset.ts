import { NextResponse } from "next/server";
import { recordAssetEvent } from "@/lib/fleet-queries";
import type { FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

/**
 * Adds a piece of material to the fleet. Admin only — the fleet list is shared
 * reference data, and a stray entry shows up in everyone's calendar.
 */
export async function handleCreateAsset(
  ctx: FleetActionContext,
  payload: FleetPayload<"create_asset">,
): Promise<NextResponse> {
  const { admin, viewer } = ctx;
  if (!viewer.isAdmin) {
    return NextResponse.json({ error: "Only admins can add material." }, { status: 403 });
  }

  const serial = payload.serial_number?.trim() || null;
  const pooled = payload.pooled ?? true;
  const holder = payload.current_holder_label?.trim() || null;

  const { data, error } = await admin
    .from("fleet_assets")
    .insert({
      name: payload.name.trim(),
      serial_number: serial,
      category: payload.category,
      model: payload.model?.trim() || null,
      owner_group: payload.owner_group?.trim() || null,
      // An assigned unit is out with someone by definition; a pooled one with no
      // holder is on the shelf. Deriving this keeps the two from disagreeing.
      status: payload.status ?? (pooled ? "available" : "out"),
      pooled,
      home_location: payload.home_location?.trim() || null,
      current_location: payload.current_location?.trim() || payload.home_location?.trim() || null,
      current_holder_label: pooled ? null : holder,
      notes: payload.notes?.trim() || null,
      location_confirmed_at: new Date().toISOString(),
    })
    .select("id, name")
    .single();

  if (error) {
    // The serial has a partial unique index; a clash is a user error, not a bug.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Serial ${serial} is already on another unit.` },
        { status: 409 },
      );
    }
    throw new Error(error.message);
  }

  await recordAssetEvent(admin, {
    asset_id: data.id,
    kind: "created",
    actor_user_id: viewer.id,
    to_location: payload.current_location?.trim() || payload.home_location?.trim() || null,
    note: `Added to the fleet${holder ? ` — assigned to ${holder}` : ""}`,
  });

  return NextResponse.json({ ok: true, asset_id: data.id, message: `${data.name} added.` });
}
