import { NextResponse } from "next/server";
import { fetchAssetSpans, fetchReliability, recordAssetEvent } from "@/lib/fleet-queries";
import { checkReservation, isBookable, parseDateKey, toDateKey } from "@/lib/fleet-rules";
import { reserveErrorMessage } from "../reserve-message";
import type { FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

export async function handleReserve(
  ctx: FleetActionContext,
  payload: FleetPayload<"reserve">,
): Promise<NextResponse> {
  const { admin, viewer, today } = ctx;
  const startDate = toDateKey(parseDateKey(payload.start_date));
  const endDate = toDateKey(parseDateKey(payload.end_date));

  // Three independent reads, so they go together: none of them needs an answer
  // from either of the others, and run one after another they cost three round
  // trips where one will do.
  const [{ data: asset, error: assetError }, reliability, existing] = await Promise.all([
    admin
      .from("fleet_assets")
      .select("id, name, status, active, current_location, pooled")
      .eq("id", payload.asset_id)
      .maybeSingle(),
    fetchReliability(admin, viewer.id, today),
    fetchAssetSpans(admin, payload.asset_id),
  ]);
  if (assetError) throw new Error(assetError.message);
  if (!asset || !asset.active) {
    return NextResponse.json({ error: "That asset no longer exists." }, { status: 404 });
  }
  if (asset.status === "retired" || asset.status === "in_repair") {
    return NextResponse.json(
      { error: `${asset.name} is ${asset.status === "retired" ? "retired" : "in repair"} and cannot be booked.` },
      { status: 409 },
    );
  }

  // A unit an admin assigned to someone (pooled = false) is not in the shared
  // pool, and only `assign` / `return_to_pool` may change that. The calendar
  // never shows it, but the id is readable, so the server has to refuse it too
  // (security audit run-4 F5). Applies to admins as well: they move units in
  // and out of the pool with those two actions, not by booking around them.
  if (!isBookable(asset)) {
    return NextResponse.json(
      { error: `${asset.name} is assigned, not in the shared pool, and cannot be booked.` },
      { status: 409 },
    );
  }

  const check = checkReservation({
    startDate,
    endDate,
    today,
    // Admins are not subject to the horizon: they schedule missions months out.
    horizonDays: viewer.isAdmin ? 365 : reliability.horizonDays,
    existing,
  });

  if (!check.ok) {
    if (check.reason === "overlap" && payload.waitlist) {
      const { data: waitRow, error: waitError } = await admin
        .from("fleet_reservations")
        .insert({
          asset_id: payload.asset_id,
          user_id: viewer.id,
          start_date: startDate,
          end_date: endDate,
          status: "waitlisted",
          purpose: payload.purpose ?? null,
          destination: payload.destination ?? null,
        })
        .select("id")
        .single();
      if (waitError) throw new Error(waitError.message);
      return NextResponse.json({
        ok: true,
        waitlisted: true,
        reservation_id: waitRow.id,
        message: `Added to the waitlist for ${asset.name}. Position is set by reliability score.`,
      });
    }
    return NextResponse.json({ error: reserveErrorMessage(check, reliability, asset.name) }, { status: 409 });
  }

  const { data: row, error } = await admin
    .from("fleet_reservations")
    .insert({
      asset_id: payload.asset_id,
      user_id: viewer.id,
      start_date: startDate,
      end_date: endDate,
      status: "reserved",
      purpose: payload.purpose ?? null,
      destination: payload.destination ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // The exclusion constraint is the authority: a concurrent request may have
    // taken the same week between our check above and this insert.
    if (error.code === "23P01") {
      return NextResponse.json(
        { error: `Someone booked ${asset.name} for those days a moment ago. Reload and try the waitlist.` },
        { status: 409 },
      );
    }
    throw new Error(error.message);
  }

  await recordAssetEvent(admin, {
    asset_id: payload.asset_id,
    reservation_id: row.id,
    kind: "reserved",
    actor_user_id: viewer.id,
    note: payload.destination ? `Destination: ${payload.destination}` : null,
  });

  return NextResponse.json({ ok: true, reservation_id: row.id });
}
