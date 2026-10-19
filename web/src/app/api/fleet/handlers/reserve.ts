import { NextResponse } from "next/server";
import { borrowCompetitors } from "@/lib/fleet-assignment";
import { sendFleetNotice } from "@/lib/fleet-notify";
import { fetchAdminUserIds, fetchAssetSpans, fetchFreeSiblings, fetchReliability, fetchUserNames, recordAssetEvent } from "@/lib/fleet-queries";
import { checkReservation, formatSpan, isBookable, isRequestable, parseDateKey, toDateKey, type ReservationSpan } from "@/lib/fleet-rules";
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
      .select("id, name, status, active, current_location, pooled, current_holder_user_id, current_holder_label")
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
  // pool, and only `assign` / `return_to_pool` may change that. It can be
  // ASKED for, though (owner decision 2026-10-19): the same request lands as a
  // pending booking plus a question to the assignee, and nothing is booked
  // until they approve. Applies to admins as well — an admin who wants a unit
  // in the pool uses `return_to_pool`, not a booking around the assignment.
  if (!isBookable(asset)) {
    if (!isRequestable(asset)) {
      return NextResponse.json(
        { error: `${asset.name} is assigned, not in the shared pool, and cannot be booked.` },
        { status: 409 },
      );
    }
    return await fileBorrowRequest(ctx, payload, {
      asset,
      startDate,
      endDate,
      horizonDays: viewer.isAdmin ? 365 : reliability.horizonDays,
      reliability,
      existing,
    });
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
    // A clash is the one refusal with a way out other than waiting: another
    // unit of the same kind that is free for those days.
    const alternatives =
      check.reason === "overlap"
        ? await fetchFreeSiblings(admin, { assetId: asset.id, startDate, endDate, today })
        : [];
    return NextResponse.json(
      { error: reserveErrorMessage(check, reliability, asset.name, alternatives), alternatives },
      { status: 409 },
    );
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

/**
 * Asks the person an assigned unit lives with to lend it.
 *
 * The booking is written as `waitlisted` — it blocks nobody and the exclusion
 * constraint ignores it — and a `borrow` request carries the question to the
 * assignee (the admins, when nobody has claimed that name). `respond_request`
 * turns it into a real booking or cancels it. The same limits apply as to any
 * booking (horizon, length), and days already lent to someone else are a clash
 * like any other; only the assignment's own open booking is not.
 */
async function fileBorrowRequest(
  ctx: FleetActionContext,
  payload: FleetPayload<"reserve">,
  args: {
    asset: { id: string; name: string; current_holder_user_id: string | null; current_holder_label: string | null };
    startDate: string;
    endDate: string;
    horizonDays: number;
    reliability: { score: number; horizonDays: number };
    existing: ReservationSpan[];
  },
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;
  const { asset, startDate, endDate } = args;

  const check = checkReservation({
    startDate,
    endDate,
    today,
    horizonDays: args.horizonDays,
    existing: borrowCompetitors(args.existing),
  });
  if (!check.ok) {
    const alternatives =
      check.reason === "overlap" ? await fetchFreeSiblings(admin, { assetId: asset.id, startDate, endDate, today }) : [];
    return NextResponse.json(
      { error: reserveErrorMessage(check, args.reliability, asset.name, alternatives), alternatives },
      { status: 409 },
    );
  }

  const holderId = asset.current_holder_user_id;
  const holderName = holderId
    ? ((await fetchUserNames(admin, [holderId])).get(holderId) ?? asset.current_holder_label ?? "its assignee")
    : (asset.current_holder_label ?? "its assignee");

  const { data: booking, error: bookingError } = await admin
    .from("fleet_reservations")
    .insert({
      asset_id: asset.id,
      user_id: viewer.id,
      start_date: startDate,
      end_date: endDate,
      status: "waitlisted",
      purpose: payload.purpose ?? null,
      destination: payload.destination ?? null,
    })
    .select("id")
    .single();
  if (bookingError) throw new Error(bookingError.message);

  const { data: request, error: requestError } = await admin
    .from("fleet_booking_requests")
    .insert({
      kind: "borrow",
      reservation_id: booking.id,
      target_reservation_id: null,
      asset_id: asset.id,
      requested_start_date: startDate,
      requested_end_date: endDate,
      requester_id: viewer.id,
      recipient_id: holderId,
      holder_label: asset.current_holder_label,
      status: "pending",
    })
    .select("id")
    .single();
  if (requestError) {
    // Do not leave a pending booking nobody can answer.
    await admin.from("fleet_reservations").delete().eq("id", booking.id);
    throw new Error(requestError.message);
  }

  await recordAssetEvent(admin, {
    asset_id: asset.id,
    reservation_id: booking.id,
    kind: "borrow_requested",
    actor_user_id: viewer.id,
    note: `${viewer.name} asked ${holderName} for ${formatSpan(startDate, endDate)}${payload.destination ? ` (${payload.destination})` : ""}`,
  });

  const recipients = holderId ? [holderId] : await fetchAdminUserIds(admin);
  await sendFleetNotice(admin, {
    input: {
      kind: "borrow_request",
      assetName: asset.name,
      requesterName: viewer.name,
      startDate,
      endDate,
      assignedTo: holderId ? null : asset.current_holder_label,
      linkReservationId: booking.id,
    },
    reservationId: booking.id,
    assetId: asset.id,
    recipientIds: recipients,
    sentForDate: today,
    origin,
    actorUserId: viewer.id,
  });

  return NextResponse.json({
    ok: true,
    requested: true,
    request_id: request.id,
    reservation_id: booking.id,
    message: `${asset.name} is assigned to ${holderName}. We asked ${holderId ? "them" : "the admins"} to lend it to you ${formatSpan(startDate, endDate)} — nothing is booked until they approve.`,
  });
}
