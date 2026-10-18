import { NextResponse } from "next/server";
import { fetchUserNames, recordAssetEvent } from "@/lib/fleet-queries";
import { sendFleetNotice } from "@/lib/fleet-notify";
import { requestExpired, shortenedStartFor, type RequestStatus } from "@/lib/fleet-requests";
import { formatDayLong, formatSpan } from "@/lib/fleet-rules";
import { applyExtensionIfReady, loadReservation, promoteWaitlist, type Admin, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

type RequestRow = {
  id: string;
  reservation_id: string;
  target_reservation_id: string;
  requested_end_date: string;
  requester_id: string | null;
  recipient_id: string | null;
  status: RequestStatus;
};

/**
 * The next booker answers an extension request.
 *
 * Only they (or an admin) can: the request is about THEIR days. Three answers:
 *   - shorten — their booking starts the day after the requested end
 *   - cancel  — their booking is cancelled (an ordinary cancellation, unscored)
 *   - decline — nothing changes; the requester is told to get in touch
 *
 * (A fourth, moving their booking to a free sibling unit, is `move_booking`,
 * which grants the request as a side effect.)
 *
 * Once every request for the same extension is accepted, the requester's
 * booking grows — see `applyExtensionIfReady`.
 */
export async function handleRespondRequest(
  ctx: FleetActionContext,
  payload: FleetPayload<"respond_request">,
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;

  const { data: request, error: readError } = await admin
    .from("fleet_booking_requests")
    .select("id, reservation_id, target_reservation_id, requested_end_date, requester_id, recipient_id, status")
    .eq("id", payload.request_id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  const row = request as RequestRow;

  // A target with no account behind it has nobody to ask, so an admin answers.
  const mayAnswer = viewer.isAdmin || (row.recipient_id !== null && row.recipient_id === viewer.id);
  if (!mayAnswer) {
    return NextResponse.json({ error: "Only the person whose booking this touches can answer." }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "That request has already been answered." }, { status: 409 });
  }

  const [target, requesterBooking] = await Promise.all([
    loadReservation(admin, row.target_reservation_id),
    loadReservation(admin, row.reservation_id),
  ]);
  if (!target || !requesterBooking) {
    await close(admin, row.id, "expired", null, viewer.id);
    return NextResponse.json({ error: "One of the bookings no longer exists." }, { status: 409 });
  }
  // The target has to be a booking that is still waiting on the shelf: once it is
  // picked up (or past its first day) the question is moot.
  if (target.status !== "reserved" || requestExpired(target, today)) {
    await close(admin, row.id, "expired", null, viewer.id);
    return NextResponse.json({ error: "That request has lapsed — the booking has already started." }, { status: 409 });
  }

  const names = await fetchUserNames(
    admin,
    [row.requester_id, row.recipient_id, viewer.id].filter((id): id is string => Boolean(id)),
  );
  const answerer = viewer.isAdmin && row.recipient_id !== viewer.id ? `${viewer.name} (admin)` : viewer.name;
  const requesterName = row.requester_id ? (names.get(row.requester_id) ?? "the requester") : "the requester";
  const assetName = requesterBooking.asset?.name ?? "Fleet material";

  if (payload.reply === "decline") {
    await close(admin, row.id, "declined", null, viewer.id);
    await recordAssetEvent(admin, {
      asset_id: requesterBooking.asset_id,
      reservation_id: requesterBooking.id,
      kind: "extension_resolved",
      actor_user_id: viewer.id,
      note: `${answerer} declined to free ${formatSpan(target.start_date, target.end_date)}`,
    });
    if (row.requester_id) {
      await sendFleetNotice(admin, {
        input: {
          kind: "extension_declined",
          assetName,
          answererName: answerer,
          currentEnd: requesterBooking.end_date,
          linkReservationId: requesterBooking.id,
        },
        reservationId: requesterBooking.id,
        assetId: requesterBooking.asset_id,
        recipientIds: [row.requester_id],
        sentForDate: today,
        origin,
        actorUserId: viewer.id,
      });
    }
    return NextResponse.json({ ok: true, reply: "declined", applied: false });
  }

  if (payload.reply === "shorten") {
    const newStart = shortenedStartFor(target, row.requested_end_date);
    if (!newStart) {
      return NextResponse.json(
        { error: "The extension covers your whole booking — cancel it instead, or decline." },
        { status: 409 },
      );
    }
    const { error } = await admin
      .from("fleet_reservations")
      .update({ start_date: newStart })
      .eq("id", target.id)
      .eq("status", "reserved");
    if (error) throw new Error(error.message);
    await recordAssetEvent(admin, {
      asset_id: target.asset_id,
      reservation_id: target.id,
      kind: "shortened",
      actor_user_id: viewer.id,
      note: `First day moved from ${target.start_date} to ${newStart} so ${requesterName} can keep the unit until ${row.requested_end_date}`,
    });
    await close(admin, row.id, "accepted", "shorten", viewer.id);
  } else {
    const { error } = await admin
      .from("fleet_reservations")
      .update({ status: "cancelled", closed_reason: "cancelled" })
      .eq("id", target.id)
      .eq("status", "reserved");
    if (error) throw new Error(error.message);
    await recordAssetEvent(admin, {
      asset_id: target.asset_id,
      reservation_id: target.id,
      kind: "cancelled",
      actor_user_id: viewer.id,
      note: `Cancelled so ${requesterName} can keep the unit until ${row.requested_end_date}`,
    });
    await close(admin, row.id, "accepted", "cancel", viewer.id);
  }

  const outcome = await applyExtensionIfReady(admin, {
    reservationId: row.reservation_id,
    requestedEnd: row.requested_end_date,
    today,
    actorUserId: viewer.id,
    answerer,
    reply: payload.reply,
    origin,
    requesterId: row.requester_id,
  });
  if (outcome.waitingOn > 0) {
    return NextResponse.json({ ok: true, reply: payload.reply, applied: false, waiting_on: outcome.waitingOn });
  }
  if (payload.reply === "cancel") {
    await promoteWaitlist(admin, target.asset_id, { origin, today, actorUserId: viewer.id });
  }

  return NextResponse.json({
    ok: true,
    reply: payload.reply,
    applied: outcome.applied,
    message: outcome.applied
      ? `${requesterName} now has the unit until ${formatDayLong(row.requested_end_date)}.`
      : "Thanks — recorded. The extension could not be applied yet because the days are still taken.",
  });
}

async function close(
  admin: Admin,
  requestId: string,
  status: Exclude<RequestStatus, "pending">,
  resolution: "shorten" | "cancel" | null,
  by: string,
) {
  const { error } = await admin
    .from("fleet_booking_requests")
    .update({ status, resolution, resolved_at: new Date().toISOString(), resolved_by: by })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}
