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
import { closureStatusFor, isBlocking } from "@/lib/fleet-rules";

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
    name: displayNameFor({
      email: user.email,
      user_metadata: (user.user_metadata ?? null) as Record<string, unknown> | null,
    }),
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
      "id, asset_id, user_id, start_date, end_date, status, destination, fleet_assets(current_location, home_location, current_holder_user_id)",
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
    | { current_location: string | null; home_location: string | null; current_holder_user_id: string | null }
    | null
    | undefined;

  return { ...reservation, asset: asset ?? null };
}

/**
 * Promotes the highest-scoring waitlist entry for a freed span to a real
 * booking. Returns the promoted reservation id, or null when nobody was
 * waiting or the span is still blocked.
 */
export async function promoteWaitlist(
  admin: Admin,
  assetId: string,
  startDate: string,
): Promise<string | null> {
  const { data: waiting, error } = await admin
    .from("fleet_reservations")
    .select("id, user_id, start_date, end_date, created_at")
    .eq("asset_id", assetId)
    .eq("status", "waitlisted")
    .eq("start_date", startDate);
  if (error || !waiting || waiting.length === 0) return null;

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
    const clash = existing.some(
      (span) =>
        isBlocking(span.status) &&
        span.start_date <= candidate.row.end_date &&
        candidate.row.start_date <= span.end_date,
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
    return candidate.row.id;
  }
  return null;
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
      .update({ status: "returned", returned_at: now, returned_on: today })
      .in("id", returned);
    if (returnError) throw new Error(returnError.message);
  }
  if (cancelled.length > 0) {
    const { error: cancelError } = await admin
      .from("fleet_reservations")
      .update({ status: "cancelled" })
      .in("id", cancelled);
    if (cancelError) throw new Error(cancelError.message);
  }
}
