import { NextResponse } from "next/server";
import { restoreAssignment } from "@/lib/fleet-assignment";
import { fetchAssetSpans, fetchReliability, fetchUserNames, recordAssetEvent } from "@/lib/fleet-queries";
import { sendFleetNotice } from "@/lib/fleet-notify";
import { FLEET_HOME_LOCATION, isBlocking } from "@/lib/fleet-rules";
import { loadReservation, promoteWaitlist, settleRequestsFor, type Admin, type FleetActionContext } from "./shared";
import type { FleetPayload } from "./schemas";

export async function handleCheckIn(
  ctx: FleetActionContext,
  payload: FleetPayload<"check_in">,
): Promise<NextResponse> {
  const { admin, viewer, today, origin } = ctx;
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

  // The return day defaults to today (Zurich). A backdated day is allowed so a
  // unit dropped off on Friday and checked in on Monday is not scored as three
  // days late — but never earlier than the booking began, and never a day that
  // has not happened yet.
  const returnedOn = payload.returned_on ?? today;
  if (returnedOn > today) {
    return NextResponse.json({ error: "The return date cannot be in the future." }, { status: 400 });
  }
  if (returnedOn < reservation.start_date) {
    return NextResponse.json(
      { error: "The return date cannot be before the booking started." },
      { status: 400 },
    );
  }

  const asset = reservation.asset;
  // A borrowed unit goes back to the person it is assigned to, not to a shelf:
  // the asset is recorded out with them again, with no location (assigned
  // material travels and nobody logs where), and their own open booking is
  // re-opened below.
  const borrow = asset?.pooled === false;
  const assignee = borrow ? await assigneeOf(admin, reservation.id, reservation.asset_id) : null;
  // A pooled unit goes back to the HQ unless the person says otherwise — there
  // is no per-unit home any more, every pooled unit lives at the same place.
  const landingSpot = borrow ? null : (payload.location ?? FLEET_HOME_LOCATION);
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
        closed_reason: "returned",
        returned_at: new Date().toISOString(),
        // A Zurich date, so an evening check-in is not counted as the next day.
        returned_on: returnedOn,
      })
      .eq("id", payload.reservation_id),
    holdsTheUnit
      ? admin
          .from("fleet_assets")
          .update(
            borrow
              ? {
                  status: "out",
                  current_holder_user_id: assignee?.user_id ?? null,
                  current_holder_label: assignee?.holder_label ?? asset?.current_holder_label ?? "Assigned",
                  current_location: null,
                  location_confirmed_at: null,
                }
              : {
                  status: "available",
                  current_holder_user_id: null,
                  current_holder_label: null,
                  current_location: landingSpot,
                  location_confirmed_at: new Date().toISOString(),
                },
          )
          .eq("id", reservation.asset_id)
      : Promise.resolve({ error: null }),
  ]);
  if (resError) throw new Error(resError.message);
  if (assetError) throw new Error(assetError.message);
  if (borrow && holdsTheUnit) {
    await restoreAssignment(admin, { assetId: reservation.asset_id, today, actorUserId: viewer.id });
  }

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
      note:
        payload.note ??
        (borrow
          ? `Back with ${assignee?.holder_label ?? asset?.current_holder_label ?? "its assignee"}${returnedOn !== today ? ` on ${returnedOn}` : ""}`
          : returnedOn !== today
            ? `Came back on ${returnedOn}, checked in ${today}`
            : null),
    }),
    promoteWaitlist(admin, reservation.asset_id, { origin, today, actorUserId: viewer.id }),
    fetchReliability(admin, reservation.user_id, today),
    // Back on the shelf: it no longer wants more days, and blocks nobody.
    settleRequestsFor(admin, reservation.id, { asRequester: "cancelled", asTarget: "expired" }),
  ]);

  // Back before the due date? The next person can start early — tell them.
  if (returnedOn < reservation.end_date) {
    const spans = await fetchAssetSpans(admin, reservation.asset_id);
    const next = spans
      .filter((s) => s.id !== reservation.id && isBlocking(s.status) && s.user_id && s.start_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    if (next?.user_id && next.user_id !== reservation.user_id) {
      const holderName = reservation.user_id
        ? ((await fetchUserNames(admin, [reservation.user_id])).get(reservation.user_id) ?? viewer.name)
        : viewer.name;
      await sendFleetNotice(admin, {
        input: {
          kind: "unit_back_early",
          assetName: asset?.name ?? "Fleet material",
          holderName,
          returnedOn,
          nextStart: next.start_date,
          nextEnd: next.end_date,
          linkReservationId: next.id,
        },
        reservationId: next.id,
        assetId: reservation.asset_id,
        recipientIds: [next.user_id],
        sentForDate: today,
        origin,
        actorUserId: viewer.id,
      });
    }
  }
  return NextResponse.json({ ok: true, promoted: promoted?.id ?? null, score });
}

/**
 * Who a borrowed unit goes back to: the borrow request names them (an account
 * when the assignee has one, else the name on the unit). Falls back to the
 * assignment booking that `check_out` closed when the borrow began.
 */
async function assigneeOf(
  admin: Admin,
  reservationId: string,
  assetId: string,
): Promise<{ user_id: string | null; holder_label: string | null } | null> {
  const { data: request } = await admin
    .from("fleet_booking_requests")
    .select("recipient_id, holder_label")
    .eq("reservation_id", reservationId)
    .eq("kind", "borrow")
    .eq("status", "accepted")
    .limit(1)
    .maybeSingle();
  const req = request as { recipient_id: string | null; holder_label: string | null } | null;
  if (req && (req.recipient_id || req.holder_label)) {
    return { user_id: req.recipient_id, holder_label: req.holder_label };
  }
  const { data: rows } = await admin
    .from("fleet_reservations")
    .select("user_id, holder_label, returned_at")
    .eq("asset_id", assetId)
    .eq("source", "sheet_import")
    .eq("status", "returned")
    .order("returned_at", { ascending: false })
    .limit(1);
  const last = ((rows ?? []) as Array<{ user_id: string | null; holder_label: string | null }>)[0];
  return last ? { user_id: last.user_id, holder_label: last.holder_label } : null;
}
