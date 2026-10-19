import type { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { hasAppAccess } from "@/lib/app-access";
import {
  displayNameFor,
  fetchAssetSpans,
  fetchReliability,
  recordAssetEvent,
  todayInZurich,
} from "@/lib/fleet-queries";
import { addDays, blockedUntil, checkReservation, closureStatusFor, formatDayLong, isBlocking } from "@/lib/fleet-rules";
import { sendFleetNotice } from "@/lib/fleet-notify";

/**
 * Types and database helpers shared by the `/api/fleet` action handlers.
 *
 * The service-role client is `"server-only"`, so it is imported here as a TYPE
 * only — the value is created in `route.ts` and handed to every handler through
 * `FleetActionContext`. Same split as `api/time-tracker/handlers/shared.ts`.
 */

/** The service-role client, as returned by `createAdminClient()`. */
export type Admin = ReturnType<typeof createAdminClient>;

/** `hasAccess` is false for a held account (no role, not admin): see lib/app-access.ts. */
export type Viewer = {
  id: string;
  email: string | null;
  name: string;
  isAdmin: boolean;
  hasAccess: boolean;
};

/** Shared context handed to every POST action handler. */
export type FleetActionContext = {
  admin: Admin;
  viewer: Viewer;
  /** Today in Europe/Zurich, resolved once per request. */
  today: string;
  /**
   * Absolute base URL of this deployment, for links that leave the browser —
   * an admin notification email cannot use a relative href. `APP_BASE_URL`
   * wins when set, otherwise the request's own origin.
   */
  origin: string;
};

/** `APP_BASE_URL`, else the request's own origin. Never a trailing slash. */
export function appBaseUrl(request: Request): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    return new URL(request.url).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export async function resolveViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: displayNameFor({ email: user.email, identities: user.identities }),
    isAdmin: isAdminEmail(user.email ?? null),
    hasAccess: hasAppAccess(user),
  };
}

/**
 * Loads a reservation together with the asset it points at.
 *
 * The asset comes back through the `asset_id` foreign key rather than as a
 * second query: check-out and check-in both need the current location, and
 * asking for it separately cost a round trip for data the database can hand
 * over in the same one.
 */
export async function loadReservation(admin: Admin, id: string) {
  const { data, error } = await admin
    .from("fleet_reservations")
    .select(
      "id, asset_id, user_id, start_date, end_date, status, destination, fleet_assets(name, status, pooled, current_location, current_holder_user_id, current_holder_label)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  // PostgREST nests the embedded row under the table name; a many-to-one
  // embed is a single object, but type it defensively either way. The raw key
  // is dropped so callers have exactly one way to reach the asset.
  const { fleet_assets: embedded, ...reservation } = data as typeof data & { fleet_assets?: unknown };
  const asset = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | {
        name: string;
        status: string;
        /** False for a unit assigned to someone — a booking on it is a borrow. */
        pooled: boolean;
        current_location: string | null;
        current_holder_user_id: string | null;
        current_holder_label: string | null;
      }
    | null
    | undefined;

  return { ...reservation, asset: asset ?? null };
}

/**
 * Promotes the highest-scoring waitlist entry whose span is now free on this
 * asset to a real booking. Returns the promoted reservation id, or null when
 * nobody was waiting or every waiting span is still blocked.
 *
 * Every waitlist entry on the asset is considered, not only those starting on
 * the day that was freed: someone waiting for Tue–Thu is just as unblocked by a
 * Mon–Wed cancellation as someone waiting for Mon–Wed, and matching on the
 * exact start date left them waiting for a unit that was already free.
 */
export type Promoted = { id: string; user_id: string; start_date: string; end_date: string };

export async function promoteWaitlist(
  admin: Admin,
  assetId: string,
  /** When given, the promoted person is told (push, else e-mail) that the unit is theirs. */
  notify?: { origin: string; today: string; actorUserId: string | null },
): Promise<Promoted | null> {
  const { data: waiting, error } = await admin
    .from("fleet_reservations")
    .select("id, user_id, start_date, end_date, created_at")
    .eq("asset_id", assetId)
    .eq("status", "waitlisted");
  if (error || !waiting || waiting.length === 0) return null;

  // On an assigned unit a `waitlisted` row is a borrow awaiting the assignee's
  // approval, not a queue — only `respond_request` may turn it into a booking.
  const { data: unit } = await admin.from("fleet_assets").select("pooled").eq("id", assetId).maybeSingle();
  if (unit && (unit as { pooled?: boolean }).pooled === false) return null;

  const today = todayInZurich();
  const existing = await fetchAssetSpans(admin, assetId);

  // Score everyone waiting, then try them in order — the first whose span is
  // actually free wins. Ordering is the score's whole purpose.
  const scored = await Promise.all(
    waiting.map(async (row) => ({
      row,
      score: (await fetchReliability(admin, row.user_id, today)).score,
    })),
  );
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.row.created_at < b.row.created_at ? -1 : a.row.created_at > b.row.created_at ? 1 : 0),
  );

  for (const candidate of scored) {
    // A span already in the past can never be collected; the sweep expires it.
    if (candidate.row.end_date < today) continue;
    const clash = existing.some(
      (span) =>
        isBlocking(span.status) &&
        span.start_date <= candidate.row.end_date &&
        candidate.row.start_date <= blockedUntil(span, today),
    );
    if (clash) continue;

    const { error: promoteError } = await admin
      .from("fleet_reservations")
      .update({ status: "reserved" })
      .eq("id", candidate.row.id)
      .eq("status", "waitlisted");
    if (promoteError) continue;

    await recordAssetEvent(admin, {
      asset_id: assetId,
      reservation_id: candidate.row.id,
      kind: "reserved",
      actor_user_id: candidate.row.user_id,
      note: "Promoted from the waitlist",
    });
    const promoted: Promoted = {
      id: candidate.row.id,
      user_id: candidate.row.user_id,
      start_date: candidate.row.start_date,
      end_date: candidate.row.end_date,
    };
    if (notify && promoted.user_id) {
      const { data: asset } = await admin.from("fleet_assets").select("name").eq("id", assetId).maybeSingle();
      await sendFleetNotice(admin, {
        input: {
          kind: "waitlist_promoted",
          assetName: asset?.name ?? "Fleet material",
          startDate: promoted.start_date,
          endDate: promoted.end_date,
          linkReservationId: promoted.id,
        },
        reservationId: promoted.id,
        assetId,
        recipientIds: [promoted.user_id],
        sentForDate: notify.today,
        origin: notify.origin,
        actorUserId: notify.actorUserId,
      });
    }
    return promoted;
  }
  return null;
}

/**
 * Once every request for an extension has been answered yes, the requester's
 * booking grows — re-checked against the live spans at that moment, because
 * bookings may have moved while people were deciding. Writes the `extended`
 * and `extension_resolved` events and tells the requester either way.
 *
 * Shared by `respond_request` (shorten / cancel) and `move_booking` (the
 * target moved out of the way), so the two cannot disagree about when an
 * extension is "ready".
 */
export async function applyExtensionIfReady(
  admin: Admin,
  args: {
    reservationId: string;
    requestedEnd: string;
    today: string;
    actorUserId: string | null;
    /** Who said yes, for the audit note and the notice. */
    answerer: string;
    reply: "shorten" | "cancel" | "move";
    origin: string;
    requesterId: string | null;
  },
): Promise<{ applied: boolean; waitingOn: number }> {
  const { data: stillPending } = await admin
    .from("fleet_booking_requests")
    .select("id")
    .eq("reservation_id", args.reservationId)
    .eq("requested_end_date", args.requestedEnd)
    .eq("status", "pending");
  const waitingOn = (stillPending ?? []).length;
  if (waitingOn > 0) return { applied: false, waitingOn };

  const booking = await loadReservation(admin, args.reservationId);
  if (!booking) return { applied: false, waitingOn: 0 };

  let applied = false;
  if ((booking.status === "reserved" || booking.status === "picked_up") && booking.end_date < args.requestedEnd) {
    const existing = await fetchAssetSpans(admin, booking.asset_id);
    const dayAfter = addDays(booking.end_date, 1);
    const check = checkReservation({
      startDate: dayAfter > args.today ? dayAfter : args.today,
      endDate: args.requestedEnd,
      today: args.today,
      horizonDays: 365,
      existing,
      ignoreId: booking.id,
    });
    if (check.ok) {
      const { error } = await admin
        .from("fleet_reservations")
        .update({ end_date: args.requestedEnd })
        .eq("id", booking.id)
        .in("status", ["reserved", "picked_up"]);
      if (!error) {
        applied = true;
        await recordAssetEvent(admin, {
          asset_id: booking.asset_id,
          reservation_id: booking.id,
          kind: "extended",
          actor_user_id: args.actorUserId,
          note: `Last day moved from ${booking.end_date} to ${args.requestedEnd} after ${args.answerer} agreed`,
        });
      }
    }
  }

  await recordAssetEvent(admin, {
    asset_id: booking.asset_id,
    reservation_id: booking.id,
    kind: "extension_resolved",
    actor_user_id: args.actorUserId,
    note: applied
      ? `${args.answerer} agreed (${args.reply}); extended to ${formatDayLong(args.requestedEnd)}`
      : `${args.answerer} agreed (${args.reply}), but the days are still taken — not extended`,
  });

  if (args.requesterId) {
    await sendFleetNotice(admin, {
      input: {
        kind: "extension_accepted",
        assetName: booking.asset?.name ?? "Fleet material",
        answererName: args.answerer,
        requestedEnd: args.requestedEnd,
        applied,
        linkReservationId: booking.id,
      },
      reservationId: booking.id,
      assetId: booking.asset_id,
      recipientIds: [args.requesterId],
      sentForDate: args.today,
      origin: args.origin,
      actorUserId: args.actorUserId,
    });
  }
  return { applied, waitingOn: 0 };
}

/**
 * Settles the extension requests a booking is party to, when that booking
 * changes in a way that makes them moot.
 *
 * - `asRequester`: requests THIS booking filed (it wanted to grow). Cancelled or
 *   checked in → withdrawn (`cancelled`); shortened → withdrawn too.
 * - `asTarget`: requests that wanted THIS booking to give way. Once it is picked
 *   up, cancelled or checked in there is nothing left to decide → `expired`.
 *
 * Best effort: a missing table (migration not applied yet) is not an error here.
 */
export async function settleRequestsFor(
  admin: Admin,
  reservationId: string,
  outcomes: { asRequester?: "cancelled"; asTarget?: "expired" },
): Promise<void> {
  const now = new Date().toISOString();
  const jobs: Array<PromiseLike<{ error: { message: string; code?: string } | null }>> = [];
  if (outcomes.asRequester) {
    jobs.push(
      admin
        .from("fleet_booking_requests")
        .update({ status: outcomes.asRequester, resolved_at: now })
        .eq("reservation_id", reservationId)
        .eq("status", "pending"),
    );
  }
  if (outcomes.asTarget) {
    jobs.push(
      admin
        .from("fleet_booking_requests")
        .update({ status: outcomes.asTarget, resolved_at: now })
        .eq("target_reservation_id", reservationId)
        .eq("status", "pending"),
    );
  }
  for (const result of await Promise.all(jobs)) {
    if (result.error && result.error.code !== "42P01") {
      console.error("fleet_booking_requests settle failed", result.error.message);
    }
  }
}

/**
 * Closes every live booking on an asset, because the asset is moving between
 * the shared pool and a fixed assignment and cannot stay booked either way.
 *
 * The two outcomes are split rather than blanket-cancelled: material that was
 * physically out is recorded as returned (and scored as such), while a booking
 * nobody ever collected is cancelled. See `closureStatusFor`.
 */
export async function closeLiveReservations(admin: Admin, assetId: string) {
  const { data: live, error } = await admin
    .from("fleet_reservations")
    .select("id, status")
    .eq("asset_id", assetId)
    .in("status", ["reserved", "picked_up"]);
  if (error) throw new Error(error.message);
  if (!live || live.length === 0) return;

  const today = todayInZurich();
  const now = new Date().toISOString();

  const returned = live.filter((row) => closureStatusFor(row.status) === "returned").map((r) => r.id);
  const cancelled = live.filter((row) => closureStatusFor(row.status) === "cancelled").map((r) => r.id);

  if (returned.length > 0) {
    const { error: returnError } = await admin
      .from("fleet_reservations")
      .update({ status: "returned", closed_reason: "returned", returned_at: now, returned_on: today })
      .in("id", returned);
    if (returnError) throw new Error(returnError.message);
  }
  if (cancelled.length > 0) {
    const { error: cancelError } = await admin
      .from("fleet_reservations")
      .update({ status: "cancelled", closed_reason: "cancelled" })
      .in("id", cancelled);
    if (cancelError) throw new Error(cancelError.message);
  }
}
