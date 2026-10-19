import { NextResponse } from "next/server";
import { recordAssetEvent } from "@/lib/fleet-queries";
import type { FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

/** Edits a piece of material. Only the fields present in the request change. */
export async function handleUpdateAsset(
  ctx: FleetActionContext,
  payload: FleetPayload<"update_asset">,
): Promise<NextResponse> {
  const { admin, viewer } = ctx;
  if (!viewer.isAdmin) {
    return NextResponse.json({ error: "Only admins can edit material." }, { status: 403 });
  }

  const { action: _action, asset_id: assetId, ...rest } = payload;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    patch[key] = typeof value === "string" ? (value.trim() || null) : value;
  }
  if (typeof patch.name === "string" && !patch.name.trim()) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }
  // Moving a unit into the pool means nobody holds it any more.
  if (patch.pooled === true) patch.current_holder_label = null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, message: "Nothing to change." });
  }

  const { data, error } = await admin
    .from("fleet_assets")
    .update(patch)
    .eq("id", assetId)
    .select("name")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That serial is already on another unit." }, { status: 409 });
    }
    throw new Error(error.message);
  }
  if (!data) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  await recordAssetEvent(admin, {
    asset_id: assetId,
    kind: "note",
    actor_user_id: viewer.id,
    note: `Edited: ${Object.keys(patch).join(", ")}`,
  });

  return NextResponse.json({ ok: true, message: `${data.name} updated.` });
}
