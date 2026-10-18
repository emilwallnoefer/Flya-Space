import "server-only";

import {
  addDays,
  computeReliability,
  daysOverdue,
  dueDateOf,
  type ClosedReason,
  type ReservationSpan,
} from "@/lib/fleet-rules";
import type { FleetBoard } from "@/lib/fleet-queries";

/**
 * Dev-only demo board.
 *
 * The fleet tables live in Supabase and this repo applies migrations by hand, so
 * a fresh checkout has no `fleet_assets` table and the panel would render an
 * error instead of a UI. When the tables are genuinely missing AND we are not in
 * production, `/api/fleet` serves this instead, so the calendar, the score and
 * the reminders can be reviewed and adjusted before anyone touches the database.
 *
 * Two hard guarantees, both enforced at the call site in `/api/fleet`:
 *   - it is never served in production;
 *   - it is never served when the tables exist (a real empty fleet stays empty).
 * The response carries `demo: true` and the panel shows a banner, so nobody can
 * mistake this for real data.
 */

const ASSETS: Array<{
  name: string;
  serial: string;
  category: FleetBoard["assets"][number]["category"];
  model: string;
  location: string;
  status: FleetBoard["assets"][number]["status"];
  confirmedDaysAgo: number | null;
}> = [
  { name: "E3-SVA-330", serial: "E300SA23200330", category: "drone", model: "Elios 3", location: "Office Paudex", status: "out", confirmedDaysAgo: 2 },
  { name: "E3-SVA-257", serial: "E300SA23130257", category: "drone", model: "Elios 3", location: "Office Paudex", status: "available", confirmedDaysAgo: 5 },
  { name: "E3-SVA-318", serial: "E300SA23190318", category: "drone", model: "Elios 3", location: "US Office", status: "out", confirmedDaysAgo: 61 },
  { name: "E3-DV1-2", serial: "E300D122160002", category: "drone", model: "Elios 3", location: "Pilots HQ Lausanne", status: "available", confirmedDaysAgo: 12 },
  { name: "E3-DV1-4", serial: "E300D122160004", category: "drone", model: "Elios 3", location: "US Office", status: "available", confirmedDaysAgo: null },
  { name: "E3-SV9-67", serial: "E300S922410067", category: "drone", model: "Elios 3", location: "FMI", status: "in_repair", confirmedDaysAgo: 9 },
  { name: "REx 0334", serial: "RV0-0334", category: "range_extender", model: "RangeX", location: "Bordeaux", status: "out", confirmedDaysAgo: 3 },
  { name: "REx 0447", serial: "REX-0447", category: "range_extender", model: "RangeX", location: "Office Paudex", status: "available", confirmedDaysAgo: 1 },
  { name: "GCS 0546", serial: "CVO-0546", category: "gcs", model: "GCS", location: "Bordeaux", status: "out", confirmedDaysAgo: 3 },
  { name: "Field tablet", serial: "", category: "accessory", model: "", location: "Office Paudex", status: "available", confirmedDaysAgo: 20 },
  { name: "E1 battery set (3x)", serial: "", category: "accessory", model: "", location: "Office Paudex", status: "available", confirmedDaysAgo: 90 },
];

const PEOPLE = [
  { id: "demo-user-charles", name: "Charles Rey" },
  { id: "demo-user-elisson", name: "Elisson Ciorcero" },
  { id: "demo-user-matteo", name: "Matteo Bianchi" },
];

/** Deterministic ids, so a reload does not reshuffle the demo board. */
function assetId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function buildDemoBoard(args: {
  viewerId: string;
  viewerName: string;
  today: string;
  windowStart: string;
  windowDays: number;
}): FleetBoard & { demo: true } {
  const { viewerId, viewerName, today, windowStart, windowDays } = args;

  const assets = ASSETS.map((asset, index) => ({
    id: assetId(index),
    serial_number: asset.serial || null,
    name: asset.name,
    category: asset.category,
    model: asset.model || null,
    owner_group: "Sales",
    status: asset.status,
    home_location: asset.location,
    current_location: asset.location,
    current_holder_user_id: null,
    current_holder_label: asset.status === "out" ? "On mission" : null,
    location_confirmed_at:
      asset.confirmedDaysAgo == null
        ? null
        : new Date(Date.parse(`${today}T00:00:00Z`) - asset.confirmedDaysAgo * 86_400_000).toISOString(),
    notes: null,
    active: true,
    // Mirrors the backfill: anything already out is an assignment, not pool stock.
    pooled: asset.status !== "out",
    kind_key: null,
    holder_name: asset.status === "out" ? "On mission" : null,
    location_age_days: asset.confirmedDaysAgo,
    location_stale: asset.confirmedDaysAgo == null || asset.confirmedDaysAgo > 42,
  }));

  // A spread that exercises every cell state the grid can draw: yours, someone
  // else's, a multi-day run, an overdue item, a back-to-back handover with no
  // gap, and a contested span with a waitlist behind it.
  const raw: Array<{
    id: string;
    asset: number;
    /** Null for a booking that is still filed under a name only. */
    user: string | null;
    name: string;
    start: string;
    end: string;
    status: ReservationSpan["status"];
    destination: string | null;
    /** Days after the due date the item actually came back. */
    returnedLate?: number;
    /** Provisional row from the spreadsheet import. */
    imported?: boolean;
  }> = [
    { id: "demo-res-1", asset: 0, user: PEOPLE[0].id, name: PEOPLE[0].name, start: addDays(today, -9), end: addDays(today, -4), status: "picked_up", destination: "Refinery Antwerp" },
    { id: "demo-res-2", asset: 1, user: viewerId, name: viewerName, start: addDays(today, -1), end: addDays(today, 2), status: "picked_up", destination: "Basel site visit" },
    { id: "demo-res-3", asset: 3, user: PEOPLE[1].id, name: PEOPLE[1].name, start: addDays(today, 3), end: addDays(today, 9), status: "reserved", destination: "Rotterdam" },
    { id: "demo-res-4", asset: 6, user: viewerId, name: viewerName, start: addDays(today, 5), end: addDays(today, 6), status: "reserved", destination: "Training room" },
    // Starts the day after demo-res-3 hands back: two adjacent runs, no conflict.
    { id: "demo-res-5", asset: 3, user: PEOPLE[2].id, name: PEOPLE[2].name, start: addDays(today, 10), end: addDays(today, 12), status: "reserved", destination: "Zurich demo" },
    { id: "demo-res-6", asset: 1, user: PEOPLE[0].id, name: PEOPLE[0].name, start: addDays(today, 14), end: addDays(today, 16), status: "reserved", destination: "Geneva demo" },
    { id: "demo-res-7", asset: 1, user: PEOPLE[2].id, name: PEOPLE[2].name, start: addDays(today, 14), end: addDays(today, 16), status: "waitlisted", destination: "Lyon demo" },
    { id: "demo-res-8", asset: 3, user: viewerId, name: viewerName, start: addDays(today, -40), end: addDays(today, -38), status: "returned", destination: "Lyon" },
    { id: "demo-res-9", asset: 4, user: PEOPLE[2].id, name: PEOPLE[2].name, start: addDays(today, -30), end: addDays(today, -27), status: "returned", destination: "Milan", returnedLate: 6 },
    // Carried over from the sheet: filed under a name, no account behind it.
    { id: "demo-res-10", asset: 2, user: null, name: "Philipp", start: addDays(today, -2), end: addDays(today, 28), status: "picked_up", destination: "US Office", imported: true },
    { id: "demo-res-11", asset: 8, user: null, name: "APAC team", start: addDays(today, -2), end: addDays(today, 28), status: "picked_up", destination: "Bordeaux", imported: true },
  ];

  const spansByUser = new Map<string, ReservationSpan[]>();
  const reservations = raw.map((row) => {
    const due = dueDateOf({ end_date: row.end });
    const span: ReservationSpan = {
      id: row.id,
      asset_id: assetId(row.asset),
      user_id: row.user,
      holder_label: row.user ? null : row.name,
      source: row.imported ? ("sheet_import" as const) : ("app" as const),
      start_date: row.start,
      end_date: row.end,
      status: row.status,
      returned_on: row.status === "returned" ? addDays(due, row.returnedLate ?? 0) : null,
    };
    if (row.user) {
      const list = spansByUser.get(row.user) ?? [];
      list.push(span);
      spansByUser.set(row.user, list);
    }

    return {
      id: row.id,
      asset_id: span.asset_id,
      user_id: row.user,
      holder_label: row.user ? null : row.name,
      source: row.imported ? ("sheet_import" as const) : ("app" as const),
      start_date: row.start,
      end_date: row.end,
      status: row.status,
      purpose: null,
      destination: row.destination,
      picked_up_at: row.status === "picked_up" ? new Date().toISOString() : null,
      returned_at: span.returned_on ? `${span.returned_on}T16:00:00Z` : null,
      returned_on: span.returned_on ?? null,
      closed_reason: (row.status === "returned"
        ? "returned"
        : row.status === "cancelled"
          ? "cancelled"
          : null) as ClosedReason | null,
      created_at: new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86_400_000).toISOString(),
      holder_name: row.name,
      is_mine: row.user === viewerId,
      due_date: due,
      days_overdue: daysOverdue(span, today),
      queue_position: row.status === "waitlisted" ? 1 : null,
      unclaimed: row.user === null,
      imported: row.imported === true,
    };
  });

  const standings = [...spansByUser.entries()]
    .map(([userId, spans]) => ({
      user_id: userId,
      name: userId === viewerId ? viewerName : (PEOPLE.find((p) => p.id === userId)?.name ?? "Unknown"),
      score: computeReliability(spans, today),
    }))
    .sort((a, b) => b.score.score - a.score.score || a.name.localeCompare(b.name));

  return {
    demo: true,
    today,
    window_start: windowStart,
    window_days: windowDays,
    assets,
    reservations,
    requests: [],
    me: { ...computeReliability(spansByUser.get(viewerId) ?? [], today), user_id: viewerId },
    standings,
    unclaimed_holders: [
      { label: "Philipp", count: 1, live: 1, mine: false },
      { label: "APAC team", count: 1, live: 1, mine: false },
    ],
    reminders_enabled: false,
    // The demo board shows the identity prompt, so it can be reviewed too.
    identity_confirmed: false,
    auto_linked: null,
    archived_assets: [],
  };
}
