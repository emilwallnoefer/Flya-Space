import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAssetSpans, recordAssetEvent } from "@/lib/fleet-queries";
import { addDays, ASSIGNMENT_SPAN_DAYS, isAssignmentSpan, isBlocking, type ReservationSpan } from "@/lib/fleet-rules";

/**
 * The open booking behind an assigned unit, and how a borrow moves it aside.
 *
 * An assigned unit (`pooled = false`) carries one live `picked_up` booking
 * with `source = 'sheet_import'` — `assign` writes it, the sheet import did —
 * which stands for "this unit lives with Charles". It is not a booking anyone
 * competes with, but the exclusion constraint does not know that: a borrow
 * approved for days inside it would collide. So:
 *
 *  - `yieldAssignmentFor` ends that booking the day before the borrow starts
 *    (or closes it as returned when the borrow starts no later than it began),
 *    right before the borrow becomes `reserved`;
 *  - `restoreAssignment` re-opens or refreshes it once the borrow is over —
 *    returned, cancelled, or never collected — so the unit is recorded with its
 *    assignee again and keeps a check-in path.
 *
 * Both are best effort on an asset that turns out to be pooled: nothing to do.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

type AssetRow = {
  id: string;
  name: string;
  pooled: boolean;
  status: string;
  current_location: string | null;
  current_holder_user_id: string | null;
  current_holder_label: string | null;
};

async function readAsset(admin: AnySupabase, assetId: string): Promise<AssetRow | null> {
  const { data } = await admin
    .from("fleet_assets")
    .select("id, name, pooled, status, current_location, current_holder_user_id, current_holder_label")
    .eq("id", assetId)
    .maybeSingle();
  return (data as AssetRow | null) ?? null;
}

/** The live rows that stand for the assignment itself (there should be one). */
export function assignmentSpansOf(spans: ReservationSpan[]): ReservationSpan[] {
  return spans.filter(isAssignmentSpan);
}

/** Everything on the unit that a borrow has to steer clear of: live bookings that are not the assignment. */
export function borrowCompetitors(spans: ReservationSpan[]): ReservationSpan[] {
  return spans.filter((s) => isBlocking(s.status) && !isAssignmentSpan(s));
}

/**
 * Makes room for a borrow starting on `startDate`: the assignment's booking
 * ends the day before, or closes as returned today when the borrow starts no
 * later than the assignment began. Nothing is scored by this — assignment rows
 * are `sheet_import`, which the score ignores.
 */
export async function yieldAssignmentFor(
  admin: AnySupabase,
  args: { assetId: string; startDate: string; today: string; actorUserId: string | null },
): Promise<void> {
  const spans = await fetchAssetSpans(admin, args.assetId);
  const now = new Date().toISOString();
  for (const row of assignmentSpansOf(spans)) {
    if (row.end_date < args.startDate) continue;
    if (row.start_date < args.startDate) {
      const { error } = await admin
        .from("fleet_reservations")
        .update({ end_date: addDays(args.startDate, -1) })
        .eq("id", row.id)
        .eq("status", "picked_up");
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin
        .from("fleet_reservations")
        .update({ status: "returned", closed_reason: "returned", returned_at: now, returned_on: args.today })
        .eq("id", row.id)
        .eq("status", "picked_up");
      if (error) throw new Error(error.message);
    }
  }
}

/** Closes the assignment's booking because the unit has physically changed hands (a borrower picked it up). */
export async function closeAssignmentRows(
  admin: AnySupabase,
  args: { assetId: string; today: string },
): Promise<number> {
  const spans = await fetchAssetSpans(admin, args.assetId);
  const rows = assignmentSpansOf(spans);
  if (rows.length === 0) return 0;
  const { error } = await admin
    .from("fleet_reservations")
    .update({ status: "returned", closed_reason: "returned", returned_at: new Date().toISOString(), returned_on: args.today })
    .in("id", rows.map((r) => r.id));
  if (error) throw new Error(error.message);
  return rows.length;
}

/**
 * Puts the assignee back on record once a borrow is over. On a pooled unit, or
 * while a borrower still has it, this does nothing. Otherwise the assignment's
 * booking is re-opened (or its due date pushed out) for `ASSIGNMENT_SPAN_DAYS`,
 * stopping the day before the next approved borrow if one is sooner, and the
 * unit is marked out with the assignee.
 */
export async function restoreAssignment(
  admin: AnySupabase,
  args: { assetId: string; today: string; actorUserId: string | null },
): Promise<"skipped" | "refreshed" | "reopened"> {
  const asset = await readAsset(admin, args.assetId);
  if (!asset || asset.pooled) return "skipped";

  const spans = await fetchAssetSpans(admin, args.assetId);
  const competitors = borrowCompetitors(spans);
  // A borrower has it in hand: the assignee gets it back at their check-in.
  if (competitors.some((s) => s.status === "picked_up")) return "skipped";
  // A borrow begins today or has already begun: the unit is theirs to collect.
  if (competitors.some((s) => s.start_date <= args.today && s.end_date >= args.today)) return "skipped";

  const nextStart = competitors
    .map((s) => s.start_date)
    .filter((d) => d > args.today)
    .sort()[0];
  let desiredEnd = addDays(args.today, ASSIGNMENT_SPAN_DAYS);
  if (nextStart) {
    const dayBefore = addDays(nextStart, -1);
    if (dayBefore < desiredEnd) desiredEnd = dayBefore;
  }
  if (desiredEnd < args.today) return "skipped";

  const holderLabel = asset.current_holder_label ?? (asset.current_holder_user_id ? null : "Assigned");
  const open = assignmentSpansOf(spans)[0];
  if (open) {
    if (open.end_date >= desiredEnd) return "refreshed";
    const { error } = await admin
      .from("fleet_reservations")
      .update({ end_date: desiredEnd })
      .eq("id", open.id)
      .eq("status", "picked_up");
    if (error && error.code !== "23P01") throw new Error(error.message);
    return "refreshed";
  }

  const { data: inserted, error } = await admin
    .from("fleet_reservations")
    .insert({
      asset_id: asset.id,
      user_id: asset.current_holder_user_id,
      holder_label: holderLabel,
      start_date: args.today,
      end_date: desiredEnd,
      status: "picked_up",
      destination: asset.current_location,
      source: "sheet_import",
      picked_up_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23P01") return "skipped";
    throw new Error(error.message);
  }
  const { error: assetError } = await admin
    .from("fleet_assets")
    .update({ status: "out" })
    .eq("id", asset.id);
  if (assetError) throw new Error(assetError.message);
  await recordAssetEvent(admin, {
    asset_id: asset.id,
    reservation_id: (inserted as { id: string }).id,
    kind: "checked_out",
    actor_user_id: args.actorUserId,
    note: `Back with ${asset.current_holder_label ?? "its assignee"} after a borrow`,
  });
  return "reopened";
}
