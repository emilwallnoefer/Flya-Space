import { NextResponse } from "next/server";
import { fetchReliability, recordAssetEvent } from "@/lib/fleet-queries";
import { loadReservation, promoteWaitlist, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

export async function handleCheckIn(
  ctx: FleetActionContext,
  payload: FleetPayload<"check_in">,
): Promise<NextResponse> {
  const { admin, viewer, today } = ctx;
  const reservation = await loadReservation(admin, payload.reservation_id);
  if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  if (reservation.user_id !== viewer.id && !viewer.isAdmin) {
    return NextResponse.json({ error: "That booking is not yours." }, { status: 403 });
  }
  // Only something that was picked up can be returned. A booking that never
  // left the shelf is closed with `cancel`, which the reliability score ignores;
  // accepting it here let anyone book today and "return" at once for an
  // on-time return that never happened (security audit run-4 F4). The UI never
  // offers it — this makes the server agree.
  if (reservation.status === "reserved") {
    return NextResponse.json(
      { error: "That booking was never picked up. Cancel it instead." },
      { status: 409 },
    );
  }
  if (reservation.status !== "picked_up") {
    return NextResponse.json({ error: "That booking is already closed." }, { status: 409 });
  }

  const asset = reservation.asset;
  const landingSpot = payload.location ?? asset?.home_location ?? asset?.current_location ?? null;
  // Free the unit only if this booking is what holds it. If someone else is
  // recorded as having it, closing this booking must not reset their unit to
  // available-at-home while it is still in their hands.
  const holder = asset?.current_holder_user_id ?? null;
  const holdsTheUnit = holder === null || holder === reservation.user_id;

  const [{ error: resError }, { error: assetError }] = await Promise.all([
    admin
      .from("fleet_reservations")
      .update({
        status: "returned",
        returned_at: new Date().toISOString(),
        // The Zurich date, so an evening check-in is not counted as the next day.
        returned_on: today,
      })
      .eq("id", payload.reservation_id),
    holdsTheUnit
      ? admin
          .from("fleet_assets")
          .update({
            status: "available",
            current_holder_user_id: null,
            current_holder_label: null,
            current_location: landingSpot,
            location_confirmed_at: new Date().toISOString(),
          })
          .eq("id", reservation.asset_id)
      : Promise.resolve({ error: null }),
  ]);
  if (resError) throw new Error(resError.message);
  if (assetError) throw new Error(assetError.message);

  // The audit event, the waitlist promotion and the score all follow from the
  // update above but not from each other, so they go together rather than in
  // series.
  const [, promoted, score] = await Promise.all([
    recordAssetEvent(admin, {
      asset_id: reservation.asset_id,
      reservation_id: reservation.id,
      kind: "checked_in",
      actor_user_id: viewer.id,
      from_location: asset?.current_location ?? null,
      to_location: landingSpot,
      note: payload.note ?? null,
    }),
    promoteWaitlist(admin, reservation.asset_id, reservation.start_date),
    fetchReliability(admin, reservation.user_id, today),
  ]);
  return NextResponse.json({ ok: true, promoted, score });
}
