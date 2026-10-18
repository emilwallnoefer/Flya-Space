import { NextResponse } from "next/server";
import { fetchAdminUserIds, fetchAssetSpans, fetchReliability, fetchUserNames, recordAssetEvent } from "@/lib/fleet-queries";
import { sendFleetNotice } from "@/lib/fleet-notify";
import { classifyDateChange, dateChangeErrorMessage } from "@/lib/fleet-requests";
import { checkReservation, formatDayLong, formatSpan, parseDateKey, toDateKey } from "@/lib/fleet-rules";
import { loadReservation, promoteWaitlist, settleRequestsFor, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

/**
 * Moves a booking's last day.
 *
 * Shortening is always allowed: the days go back to the pool and the waitlist
 * is promoted. Extending has to find the extra days free. When they belong to
 * someone else's booking, nothing changes: one extension REQUEST is filed per
 * colliding booking, and the next booker decides (see `respond-request.ts`).
 * Never auto-move another person's booking — that is the owner's decision,
 * recorded in web/docs/fleet-edge-cases.md.
 */
export async function handleChangeDates(
  ctx: FleetActionContext,
  payload: FleetPayload<"change_dates">,
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;
  const newEnd = toDateKey(parseDateKey(payload.end_date));

  const reservation = await loadReservation(admin, payload.reservation_id);
  if (!reservation) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  if (reservation.user_id !== viewer.id && !viewer.isAdmin) {
    return NextResponse.json({ error: "That booking is not yours." }, { status: 403 });
  }
  const assetName = reservation.asset?.name ?? "This unit";

  // Admins schedule months out; everyone else is bounded by their score.
  const reliability = reservation.user_id ? await fetchReliability(admin, reservation.user_id, today) : null;
  const horizonDays = viewer.isAdmin ? 365 : (reliability?.horizonDays ?? 7);

  const change = classifyDateChange({ span: reservation, newEnd, today, horizonDays });
  if (change.kind === "none" || change.kind === "invalid") {
    return NextResponse.json(
      { error: dateChangeErrorMessage(change, reliability?.score ?? 0) },
      { status: change.kind === "none" ? 400 : 409 },
    );
  }

  if (change.kind === "shorten") {
    const { error } = await admin
      .from("fleet_reservations")
      .update({ end_date: newEnd })
      .eq("id", reservation.id)
      .in("status", ["reserved", "picked_up"]);
    if (error) throw new Error(error.message);

    // Giving days back makes any pending extension of this booking moot.
    await Promise.all([
      recordAssetEvent(admin, {
        asset_id: reservation.asset_id,
        reservation_id: reservation.id,
        kind: "shortened",
        actor_user_id: viewer.id,
        note: `Last day moved from ${reservation.end_date} to ${newEnd}`,
      }),
      settleRequestsFor(admin, reservation.id, { asRequester: "cancelled" }),
      promoteWaitlist(admin, reservation.asset_id, { origin, today, actorUserId: viewer.id }),
    ]);
    return NextResponse.json({ ok: true, change: "shortened", end_date: newEnd });
  }

  // Extend: the added stretch has to be free of everybody else.
  const existing = await fetchAssetSpans(admin, reservation.asset_id);
  const check = checkReservation({
    startDate: change.added.start_date,
    endDate: change.added.end_date,
    today,
    horizonDays: 365, // already judged above, against the NEW end date
    existing,
    ignoreId: reservation.id,
  });

  if (check.ok) {
    const { error } = await admin
      .from("fleet_reservations")
      .update({ end_date: newEnd })
      .eq("id", reservation.id)
      .in("status", ["reserved", "picked_up"]);
    if (error) {
      // The exclusion constraint is the authority under concurrency.
      if (error.code === "23P01") {
        return NextResponse.json(
          { error: `Someone booked ${assetName} for those days a moment ago. Reload and try again.` },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }
    await recordAssetEvent(admin, {
      asset_id: reservation.asset_id,
      reservation_id: reservation.id,
      kind: "extended",
      actor_user_id: viewer.id,
      note: `Last day moved from ${reservation.end_date} to ${newEnd}`,
    });
    return NextResponse.json({ ok: true, change: "extended", end_date: newEnd });
  }

  if (check.reason !== "overlap") {
    // Cannot happen for a well-formed added span, but refuse rather than guess.
    return NextResponse.json({ error: "Those days cannot be booked." }, { status: 409 });
  }

  // The days belong to someone else: ask them. One request per colliding
  // booking; the extension applies only once every one of them has said yes.
  const requesterId = reservation.user_id ?? viewer.id;
  const holderIds = check.conflicting.map((c) => c.user_id).filter((id): id is string => Boolean(id));
  const names = await fetchUserNames(admin, holderIds);
  const asked: Array<{ request_id: string | null; holder: string; dates: string; already_pending: boolean }> = [];

  for (const target of check.conflicting) {
    const holder = target.user_id ? (names.get(target.user_id) ?? "a colleague") : (target.holder_label ?? "a colleague");
    const { data: row, error } = await admin
      .from("fleet_booking_requests")
      .insert({
        kind: "extension",
        reservation_id: reservation.id,
        target_reservation_id: target.id,
        requested_end_date: newEnd,
        requester_id: requesterId,
        recipient_id: target.user_id,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) {
      // The partial unique index: this exact question is already open.
      if (error.code === "23505") {
        asked.push({ request_id: null, holder, dates: formatSpan(target.start_date, target.end_date), already_pending: true });
        continue;
      }
      throw new Error(error.message);
    }
    asked.push({ request_id: row.id, holder, dates: formatSpan(target.start_date, target.end_date), already_pending: false });
    await recordAssetEvent(admin, {
      asset_id: reservation.asset_id,
      reservation_id: reservation.id,
      kind: "extension_requested",
      actor_user_id: viewer.id,
      note: `Asked ${holder} to free ${formatSpan(change.added.start_date, newEnd)} (their booking ${formatSpan(target.start_date, target.end_date)})`,
    });
    // Tell the person who has to answer — or the admins, when the target
    // booking has no account behind it.
    const recipients = target.user_id ? [target.user_id] : await fetchAdminUserIds(admin);
    await sendFleetNotice(admin, {
      input: {
        kind: "extension_request",
        assetName,
        requesterName: viewer.isAdmin && reservation.user_id !== viewer.id ? `${viewer.name} (admin)` : viewer.name,
        requestedEnd: newEnd,
        targetStart: target.start_date,
        targetEnd: target.end_date,
        linkReservationId: target.id,
      },
      reservationId: target.id,
      assetId: reservation.asset_id,
      recipientIds: recipients,
      sentForDate: today,
      origin,
      actorUserId: viewer.id,
    });
  }

  const who = asked.map((a) => a.holder).join(" and ");
  return NextResponse.json({
    ok: true,
    change: "requested",
    pending: true,
    asked,
    message: `${who} ${asked.length === 1 ? "has" : "have"} ${assetName} booked from ${formatDayLong(change.added.start_date)}. We asked ${asked.length === 1 ? "them" : "each of them"} to free the days — your booking stays as it is until they answer. If it is urgent, get in touch directly.`,
  });
}
