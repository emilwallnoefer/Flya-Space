import { NextResponse } from "next/server";
import { borrowCompetitors, yieldAssignmentFor } from "@/lib/fleet-assignment";
import { fetchAssetSpans, fetchUserNames, recordAssetEvent } from "@/lib/fleet-queries";
import { sendFleetNotice } from "@/lib/fleet-notify";
import { requestExpired, shortenedStartFor, type RequestKind, type RequestStatus } from "@/lib/fleet-requests";
import { checkReservation, formatDayLong, formatSpan } from "@/lib/fleet-rules";
import { applyExtensionIfReady, loadReservation, promoteWaitlist, type Admin, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

type RequestRow = {
  id: string;
  kind: RequestKind | null;
  reservation_id: string;
  target_reservation_id: string | null;
  asset_id: string | null;
  requested_start_date: string | null;
  requested_end_date: string;
  requester_id: string | null;
  recipient_id: string | null;
  holder_label: string | null;
  status: RequestStatus;
};

/**
 * The recipient answers a request.
 *
 * Only they (or an admin) can. Two kinds of question:
 *
 *  - An EXTENSION asks the next booker to free their days. Three answers:
 *    `shorten` (their booking starts the day after the requested end), `cancel`
 *    (an ordinary, unscored cancellation), `decline` (nothing changes; the
 *    requester is told to get in touch). A fourth — moving their booking to a
 *    free sibling — is `move_booking`, which grants the request as a side
 *    effect. Once every request for the same extension is accepted, the
 *    requester's booking grows (`applyExtensionIfReady`).
 *
 *  - A BORROW asks the person an assigned unit lives with to lend it. Two
 *    answers: `approve` (the pending booking becomes real, and the assignment's
 *    own booking steps aside for those days) or `decline` (the pending booking
 *    is cancelled). Admins answer when the assignee has no account.
 */
export async function handleRespondRequest(
  ctx: FleetActionContext,
  payload: FleetPayload<"respond_request">,
): Promise<NextResponse> {
  const { admin, viewer, today } = ctx;

  const { data: request, error: readError } = await admin
    .from("fleet_booking_requests")
    .select(
      "id, kind, reservation_id, target_reservation_id, asset_id, requested_start_date, requested_end_date, requester_id, recipient_id, holder_label, status",
    )
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

  const names = await fetchUserNames(
    admin,
    [row.requester_id, row.recipient_id, viewer.id].filter((id): id is string => Boolean(id)),
  );
  const answerer = viewer.isAdmin && row.recipient_id !== viewer.id ? `${viewer.name} (admin)` : viewer.name;
  const requesterName = row.requester_id ? (names.get(row.requester_id) ?? "the requester") : "the requester";

  if (row.kind === "borrow") {
    return await answerBorrow(ctx, row, payload.reply, { answerer, requesterName });
  }
  if (payload.reply === "approve") {
    return NextResponse.json({ error: "An extension request is answered with shorten, cancel or decline." }, { status: 400 });
  }
  const { origin } = ctx;

  const [target, requesterBooking] = await Promise.all([
    row.target_reservation_id ? loadReservation(admin, row.target_reservation_id) : Promise.resolve(null),
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

/**
 * The assignee's answer to a borrow. Approval re-checks the days against every
 * other borrow on the unit at that moment (the assignment's own booking is not
 * a clash — `yieldAssignmentFor` moves it aside), then flips the pending
 * booking to `reserved`; the exclusion constraint has the last word.
 */
async function answerBorrow(
  ctx: FleetActionContext,
  row: RequestRow,
  reply: FleetPayload<"respond_request">["reply"],
  who: { answerer: string; requesterName: string },
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;
  if (reply !== "approve" && reply !== "decline") {
    return NextResponse.json({ error: "A borrow request is answered with approve or decline." }, { status: 400 });
  }

  const booking = await loadReservation(admin, row.reservation_id);
  if (!booking) {
    await close(admin, row.id, "expired", null, viewer.id);
    return NextResponse.json({ error: "That request's booking no longer exists." }, { status: 409 });
  }
  if (booking.status !== "waitlisted" || booking.end_date < today) {
    await close(admin, row.id, "expired", null, viewer.id);
    return NextResponse.json({ error: "That request has lapsed." }, { status: 409 });
  }
  const assetName = booking.asset?.name ?? "Fleet material";
  const span = formatSpan(booking.start_date, booking.end_date);
  const notify = (kind: "borrow_approved" | "borrow_declined") =>
    row.requester_id
      ? sendFleetNotice(admin, {
          input: {
            kind,
            assetName,
            answererName: who.answerer,
            startDate: booking.start_date,
            endDate: booking.end_date,
            linkReservationId: booking.id,
          },
          reservationId: booking.id,
          assetId: booking.asset_id,
          recipientIds: [row.requester_id],
          sentForDate: today,
          origin,
          actorUserId: viewer.id,
        })
      : Promise.resolve([]);

  if (reply === "decline") {
    const { error } = await admin
      .from("fleet_reservations")
      .update({ status: "cancelled", closed_reason: "cancelled" })
      .eq("id", booking.id)
      .eq("status", "waitlisted");
    if (error) throw new Error(error.message);
    await close(admin, row.id, "declined", null, viewer.id);
    await recordAssetEvent(admin, {
      asset_id: booking.asset_id,
      reservation_id: booking.id,
      kind: "borrow_resolved",
      actor_user_id: viewer.id,
      note: `${who.answerer} declined to lend it to ${who.requesterName} ${span}`,
    });
    await notify("borrow_declined");
    return NextResponse.json({ ok: true, reply: "declined", applied: false });
  }

  // Approve. Another borrow may have been approved for those days meanwhile.
  const existing = await fetchAssetSpans(admin, booking.asset_id);
  const check = checkReservation({
    startDate: booking.start_date > today ? booking.start_date : today,
    endDate: booking.end_date,
    today,
    horizonDays: 365,
    existing: borrowCompetitors(existing),
    ignoreId: booking.id,
  });
  if (!check.ok) {
    return NextResponse.json(
      { error: `${assetName} is already lent to someone else on some of those days. Decline, or ask ${who.requesterName} to pick other dates.` },
      { status: 409 },
    );
  }

  await yieldAssignmentFor(admin, { assetId: booking.asset_id, startDate: booking.start_date, today, actorUserId: viewer.id });
  const { error } = await admin
    .from("fleet_reservations")
    .update({ status: "reserved" })
    .eq("id", booking.id)
    .eq("status", "waitlisted");
  if (error) {
    if (error.code === "23P01") {
      return NextResponse.json(
        { error: `${assetName} was booked for those days a moment ago. Reload and try again.` },
        { status: 409 },
      );
    }
    throw new Error(error.message);
  }
  await close(admin, row.id, "accepted", "approve", viewer.id);
  await Promise.all([
    recordAssetEvent(admin, {
      asset_id: booking.asset_id,
      reservation_id: booking.id,
      kind: "borrow_resolved",
      actor_user_id: viewer.id,
      note: `${who.answerer} approved lending it to ${who.requesterName} ${span}`,
    }),
    recordAssetEvent(admin, {
      asset_id: booking.asset_id,
      reservation_id: booking.id,
      kind: "reserved",
      actor_user_id: row.requester_id,
      note: `Borrow approved by ${who.answerer}`,
    }),
  ]);
  await notify("borrow_approved");
  return NextResponse.json({
    ok: true,
    reply: "approved",
    applied: true,
    message: `${who.requesterName} has ${assetName} ${span}. Hand it over on ${formatDayLong(booking.start_date)}.`,
  });
}

async function close(
  admin: Admin,
  requestId: string,
  status: Exclude<RequestStatus, "pending">,
  resolution: "shorten" | "cancel" | "approve" | null,
  by: string,
) {
  const { error } = await admin
    .from("fleet_booking_requests")
    .update({ status, resolution, resolved_at: new Date().toISOString(), resolved_by: by })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}
