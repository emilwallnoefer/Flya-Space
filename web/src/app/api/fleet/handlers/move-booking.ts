import { NextResponse } from "next/server";
import { fetchAssetSpans, fetchFreeSiblings, recordAssetEvent } from "@/lib/fleet-queries";
import { checkReservation, isBookable } from "@/lib/fleet-rules";
import { applyExtensionIfReady, loadReservation, promoteWaitlist, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

/**
 * Moves a booking to another unit for the same days — the owner's one-tap
 * answer to "the unit I booked has not come back" or "someone needs it
 * longer". Only the owner (or an admin) may do it, only before pick-up, and
 * only onto a unit that is free for every day of the booking; the exclusion
 * constraint has the last word under concurrency.
 *
 * Any extension request that was waiting on this booking is thereby granted:
 * the collision is gone, so it is closed as accepted (`move`) and the
 * requester's booking grows if nothing else stands in the way.
 */
export async function handleMoveBooking(
  ctx: FleetActionContext,
  payload: FleetPayload<"move_booking">,
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;
  const reservation = await loadReservation(admin, payload.reservation_id);
  if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  if (reservation.user_id !== viewer.id && !viewer.isAdmin) {
    return NextResponse.json({ error: "That booking is not yours." }, { status: 403 });
  }
  if (reservation.status === "picked_up") {
    return NextResponse.json(
      { error: "That unit is already in your hands — check it in, then book the other one." },
      { status: 409 },
    );
  }
  if (reservation.status !== "reserved") {
    return NextResponse.json({ error: "Only a confirmed booking can be moved." }, { status: 409 });
  }
  if (payload.asset_id === reservation.asset_id) {
    return NextResponse.json({ error: "That is the unit it is already on." }, { status: 400 });
  }

  const [{ data: target, error: targetError }, existing] = await Promise.all([
    admin
      .from("fleet_assets")
      .select("id, name, status, active, pooled, current_location")
      .eq("id", payload.asset_id)
      .maybeSingle(),
    fetchAssetSpans(admin, payload.asset_id),
  ]);
  if (targetError) throw new Error(targetError.message);
  if (!target || !target.active) return NextResponse.json({ error: "That unit no longer exists." }, { status: 404 });
  if (!isBookable(target)) {
    return NextResponse.json({ error: `${target.name} cannot be booked right now.` }, { status: 409 });
  }

  // Same days, already approved once — only the new unit's calendar matters.
  const check = checkReservation({
    startDate: reservation.start_date,
    endDate: reservation.end_date,
    today,
    horizonDays: 365,
    existing,
  });
  if (!check.ok) {
    const alternatives = await fetchFreeSiblings(admin, {
      assetId: reservation.asset_id,
      startDate: reservation.start_date,
      endDate: reservation.end_date,
      today,
    });
    return NextResponse.json(
      {
        error:
          check.reason === "overlap"
            ? `${target.name} is taken on some of those days.`
            : check.reason === "past"
              ? "That booking has already started; it cannot be moved."
              : `${target.name} cannot take those days.`,
        alternatives,
      },
      { status: 409 },
    );
  }

  const fromAssetId = reservation.asset_id;
  const { error } = await admin
    .from("fleet_reservations")
    .update({ asset_id: target.id })
    .eq("id", reservation.id)
    .eq("status", "reserved");
  if (error) {
    if (error.code === "23P01") {
      return NextResponse.json(
        { error: `Someone booked ${target.name} for those days a moment ago. Reload and try again.` },
        { status: 409 },
      );
    }
    throw new Error(error.message);
  }

  const fromName = reservation.asset?.name ?? "the previous unit";
  await Promise.all([
    recordAssetEvent(admin, {
      asset_id: fromAssetId,
      reservation_id: reservation.id,
      kind: "moved_booking",
      actor_user_id: viewer.id,
      note: `Booking moved to ${target.name}`,
    }),
    recordAssetEvent(admin, {
      asset_id: target.id,
      reservation_id: reservation.id,
      kind: "moved_booking",
      actor_user_id: viewer.id,
      note: `Booking moved here from ${fromName}`,
    }),
  ]);

  // The days on the old unit are free again: whoever waited for them, and
  // whoever asked to extend into them, gets what they were waiting for.
  const { data: waitingOnMe } = await admin
    .from("fleet_booking_requests")
    .select("id, reservation_id, requested_end_date, requester_id")
    .eq("target_reservation_id", reservation.id)
    .eq("status", "pending");
  const granted: string[] = [];
  for (const req of (waitingOnMe ?? []) as Array<{ id: string; reservation_id: string; requested_end_date: string; requester_id: string | null }>) {
    await admin
      .from("fleet_booking_requests")
      .update({ status: "accepted", resolution: "move", resolved_at: new Date().toISOString(), resolved_by: viewer.id })
      .eq("id", req.id)
      .eq("status", "pending");
    const outcome = await applyExtensionIfReady(admin, {
      reservationId: req.reservation_id,
      requestedEnd: req.requested_end_date,
      today,
      actorUserId: viewer.id,
      answerer: viewer.name,
      reply: "move",
      origin,
      requesterId: req.requester_id,
    });
    if (outcome.applied) granted.push(req.reservation_id);
  }
  await promoteWaitlist(admin, fromAssetId, { origin, today, actorUserId: viewer.id });

  return NextResponse.json({
    ok: true,
    moved_to: target.id,
    granted,
    message: `Moved to ${target.name}${target.current_location ? ` (${target.current_location})` : ""} for the same days.`,
  });
}
