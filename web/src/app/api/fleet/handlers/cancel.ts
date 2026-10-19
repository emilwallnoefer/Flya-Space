import { NextResponse } from "next/server";
import { restoreAssignment } from "@/lib/fleet-assignment";
import { recordAssetEvent } from "@/lib/fleet-queries";
import { loadReservation, promoteWaitlist, settleRequestsFor, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

export async function handleCancel(
  ctx: FleetActionContext,
  payload: FleetPayload<"cancel">,
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;
  const reservation = await loadReservation(admin, payload.reservation_id);
  if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  if (reservation.user_id !== viewer.id && !viewer.isAdmin) {
    return NextResponse.json({ error: "That booking is not yours." }, { status: 403 });
  }
  if (reservation.status === "picked_up") {
    return NextResponse.json(
      { error: "The material is already out — check it back in instead of cancelling." },
      { status: 409 },
    );
  }
  if (reservation.status === "returned") {
    return NextResponse.json({ error: "That booking is already closed." }, { status: 409 });
  }

  const { error } = await admin
    .from("fleet_reservations")
    .update({ status: "cancelled", closed_reason: "cancelled" })
    .eq("id", payload.reservation_id);
  if (error) throw new Error(error.message);

  // Cancelling frees the week: promote the top of the waitlist, which is
  // ordered by reliability score. That and the audit event are independent of
  // each other, so they go together.
  const [, promoted] = await Promise.all([
    recordAssetEvent(admin, {
      asset_id: reservation.asset_id,
      reservation_id: reservation.id,
      kind: "cancelled",
      actor_user_id: viewer.id,
    }),
    promoteWaitlist(admin, reservation.asset_id, { origin, today, actorUserId: viewer.id }),
    // A cancelled booking neither wants to grow nor stands in anyone's way. For a
    // pending borrow this is also what withdraws the question.
    settleRequestsFor(admin, reservation.id, { asRequester: "cancelled", asTarget: "expired" }),
  ]);
  // An approved borrow that is cancelled gives the days back to the assignee.
  if (reservation.asset?.pooled === false && reservation.status === "reserved") {
    await restoreAssignment(admin, { assetId: reservation.asset_id, today, actorUserId: viewer.id });
  }
  return NextResponse.json({ ok: true, promoted: promoted?.id ?? null });
}
