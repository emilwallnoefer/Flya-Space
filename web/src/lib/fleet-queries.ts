import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeReliability,
  daysOverdue,
  dueDateOf,
  holderLabelMatchesPerson,
  isBlocking,
  isBookable,
  mondayOf,
  normalizeHolderLabel,
  orderQueue,
  type ReliabilityScore,
  type ReservationSource,
  type ReservationSpan,
  type ReservationStatus,
} from "@/lib/fleet-rules";

/**
 * Fleet reads.
 *
 * Every write in this module goes through the service-role client (see
 * `/api/fleet`), because the rules that make the module work — booking horizon,
 * queue order, who may mark something returned — cannot be expressed as RLS.
 * Reads are wide on purpose: the fleet is shared property and everyone signed
 * in can see the whole board.
 */

export const ZURICH_TZ = "Europe/Zurich";

/** Today in Europe/Zurich as `YYYY-MM-DD`, so "overdue" matches the office day. */
export function todayInZurich(now: Date = new Date()): string {
  // en-CA renders ISO-ordered dates, which is exactly the key format we use.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZURICH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type FleetAssetCategory =
  | "drone"
  | "lidar"
  | "rad_payload"
  | "ut_payload"
  | "lel_payload"
  | "dummy_drone"
  | "tether"
  | "range_extender"
  | "gcs"
  | "accessory"
  | "other";

/**
 * Category order used for every asset listing — the fleet sheet's own order.
 * Postgres would sort these alphabetically, which puts dummy drones above the
 * real drone fleet, so the ordering is applied here instead.
 */
const CATEGORY_RANK: Record<FleetAssetCategory, number> = {
  drone: 0,
  lidar: 1,
  rad_payload: 2,
  ut_payload: 3,
  lel_payload: 4,
  dummy_drone: 5,
  tether: 6,
  range_extender: 7,
  gcs: 8,
  accessory: 9,
  other: 10,
};
export type FleetAssetStatus = "available" | "reserved" | "out" | "in_repair" | "retired";

export type FleetAssetRow = {
  id: string;
  serial_number: string | null;
  name: string;
  category: FleetAssetCategory;
  model: string | null;
  owner_group: string | null;
  status: FleetAssetStatus;
  home_location: string | null;
  current_location: string | null;
  current_holder_user_id: string | null;
  current_holder_label: string | null;
  location_confirmed_at: string | null;
  notes: string | null;
  active: boolean;
  /** True when the unit is part of the shared bookable pool (and so, the calendar). */
  pooled: boolean;
};

export type FleetReservationRow = {
  id: string;
  asset_id: string;
  /** Null while the booking is filed under a name nobody has claimed. */
  user_id: string | null;
  holder_label: string | null;
  source: ReservationSource;
  start_date: string;
  end_date: string;
  status: ReservationStatus;
  purpose: string | null;
  destination: string | null;
  picked_up_at: string | null;
  returned_at: string | null;
  returned_on: string | null;
  created_at: string;
};

/** A reservation decorated with everything the calendar needs to render it. */
export type FleetReservationView = FleetReservationRow & {
  holder_name: string;
  is_mine: boolean;
  due_date: string;
  days_overdue: number;
  /** Position in the waitlist for this span, 1-based. Null unless waitlisted. */
  queue_position: number | null;
  /** No account behind this booking yet — it is filed under a name. */
  unclaimed: boolean;
  /** Carried over from the spreadsheet: provisional, and excluded from scoring. */
  imported: boolean;
};

export type FleetAssetView = FleetAssetRow & {
  holder_name: string | null;
  /** Days since anyone confirmed where this is; null when never confirmed. */
  location_age_days: number | null;
  /** True when the location has not been confirmed within `STALE_LOCATION_DAYS`. */
  location_stale: boolean;
};

export type FleetBoard = {
  today: string;
  /** First day rendered by the calendar. */
  window_start: string;
  /** How many days the calendar renders. */
  window_days: number;
  assets: FleetAssetView[];
  reservations: FleetReservationView[];
  /** The signed-in user's own standing. */
  me: ReliabilityScore & { user_id: string };
  /** Everyone's standing, for the leaderboard. Admins see all; others see it too — visibility is the incentive. */
  standings: Array<{ user_id: string; name: string; score: ReliabilityScore }>;
  /**
   * Holder names with live bookings and no account behind them, so the UI can
   * chase them. `mine` is the subset the viewer is allowed to claim themselves.
   */
  unclaimed_holders: Array<{
    label: string;
    /** Every booking under this name, finished ones included. */
    count: number;
    /** How many are holding material right now. */
    live: number;
    mine: boolean;
  }>;
  /** Whether return reminders are currently being sent at all. */
  reminders_enabled: boolean;
  /**
   * Whether this user has been through the "which of these names is you?" step.
   * True once they have any alias — whether they claimed a legacy name or
   * registered as a new member. Drives the one-time prompt, and lives on the
   * server rather than in localStorage so it is asked once per PERSON rather
   * than once per browser.
   */
  identity_confirmed: boolean;
  /**
   * Set when this load linked the user to a legacy name automatically, so the
   * UI can tell them what just happened rather than silently rewriting history
   * under their account.
   */
  auto_linked: { label: string; bookings: number; assets: number } | null;
  /**
   * Units removed from the fleet (`active = false`). Present only for admins,
   * so the Manage tab can restore one — a soft removal you cannot see is a
   * removal you cannot undo.
   */
  archived_assets: FleetAssetRow[];
};

/**
 * A location nobody has re-confirmed in six weeks is treated as stale. The old
 * sheet's real failure mode was a location column that was technically filled
 * in and two years out of date.
 *
 * A location that has NEVER been confirmed is not stale — it is simply new.
 * Counting those as stale flagged all 31 freshly-loaded units at once, which is
 * noise, and noise is how a warning stops being read.
 */
export const STALE_LOCATION_DAYS = 42;

/**
 * How many days the calendar renders at once. Four weeks: wide enough to plan a
 * month of missions, narrow enough that a day column stays clickable on a laptop.
 */
export const DEFAULT_WINDOW_DAYS = 28;

/** The service-role client, typed the way the other query modules type it. */
type AnySupabase = SupabaseClient;

function toSpan(row: FleetReservationRow): ReservationSpan {
  return {
    id: row.id,
    asset_id: row.asset_id,
    user_id: row.user_id,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    returned_on: row.returned_on,
    holder_label: row.holder_label,
    source: row.source,
  };
}

/**
 * The name to show for — and attribute actions to — an account.
 *
 * Read from the sign-in provider's profile (`identities[].identity_data`, e.g.
 * the Google Workspace name), falling back to the email local part. NEVER from
 * `user_metadata`: the user can rewrite that from the browser with
 * `updateUser()`, so a name taken from it is a name they chose. It used to be,
 * which let anyone appear as a colleague on the leaderboard, in fleet history,
 * and to the holder-claim check that decides whether admins are alerted
 * (security audit run-4 F7). Supabase writes identity data from the provider
 * at sign-in; `updateUser()` cannot touch it.
 */
export function displayNameFor(user: {
  email?: string | null;
  identities?: ReadonlyArray<{ provider?: string; identity_data?: Record<string, unknown> | null }> | null;
}): string {
  const identities = [...(user.identities ?? [])].sort(
    // Prefer the Google profile when an account has several identities.
    (a, b) => Number(b.provider === "google") - Number(a.provider === "google"),
  );
  for (const identity of identities) {
    for (const key of ["full_name", "name"]) {
      const value = identity.identity_data?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const local = (user.email ?? "").split("@")[0] ?? "";
  if (!local) return "Unknown";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || local
  );
}

/**
 * Loads every asset plus all reservations that touch the rendered window OR are
 * still live (a booking that started before the window but has not come back
 * must stay visible, otherwise an overdue item disappears off the left edge).
 */
export async function fetchFleetBoard(
  admin: AnySupabase,
  args: {
    viewerId: string;
    /** Used to decide which unclaimed holder names the viewer may claim. */
    viewerName?: string | null;
    viewerEmail?: string | null;
    /** Admins additionally receive the archived units. */
    includeArchived?: boolean;
    /** Result of `autoLinkHolder`, when this load performed one. */
    autoLinked?: { label: string; bookings: number; assets: number } | null;
    windowStart?: string;
    windowDays?: number;
    now?: Date;
  },
): Promise<FleetBoard> {
  const now = args.now ?? new Date();
  const today = todayInZurich(now);
  // The window always starts on the Monday of the requested (or current) week,
  // so a Friday still shows the whole week and the board rolls over on Monday.
  const windowStart = mondayOf(args.windowStart ?? today);
  const windowDays = args.windowDays ?? DEFAULT_WINDOW_DAYS;

  const [
    assetsResult,
    reservationsResult,
    remindersEnabled,
    myAliasResult,
    directory,
    archivedResult,
  ] = await Promise.all([
    admin
      .from("fleet_assets")
      .select(
        "id, serial_number, name, category, model, owner_group, status, home_location, current_location, current_holder_user_id, current_holder_label, location_confirmed_at, notes, active, pooled",
      )
      .eq("active", true)
      .order("name", { ascending: true }),
    admin
      .from("fleet_reservations")
      .select(
        "id, asset_id, user_id, holder_label, source, start_date, end_date, status, purpose, destination, picked_up_at, returned_at, returned_on, created_at",
      )
      .order("start_date", { ascending: true }),
    fetchRemindersEnabled(admin),
    admin.from("fleet_holder_aliases").select("label").eq("user_id", args.viewerId).limit(1),
    fetchHolderDirectory(admin),
    args.includeArchived
      ? admin
          .from("fleet_assets")
          .select(
            "id, serial_number, name, category, model, owner_group, status, home_location, current_location, current_holder_user_id, current_holder_label, location_confirmed_at, notes, active, pooled",
          )
          .eq("active", false)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (assetsResult.error) throw new Error(`fleet_assets read failed: ${assetsResult.error.message}`);
  if (reservationsResult.error) {
    throw new Error(`fleet_reservations read failed: ${reservationsResult.error.message}`);
  }

  const assets = ((assetsResult.data ?? []) as FleetAssetRow[]).sort(
    (a, b) =>
      (CATEGORY_RANK[a.category] ?? 99) - (CATEGORY_RANK[b.category] ?? 99) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const reservations = (reservationsResult.data ?? []) as FleetReservationRow[];

  // Resolve the names behind every user id we are about to render, in one call.
  const userIds = new Set<string>([args.viewerId]);
  for (const row of reservations) if (row.user_id) userIds.add(row.user_id);
  for (const asset of assets) if (asset.current_holder_user_id) userIds.add(asset.current_holder_user_id);
  const names = await fetchUserNames(admin, [...userIds]);

  // Waitlist positions, computed per (asset, start_date) group so a contested
  // span shows everyone where they stand. Ordering is score-first: the whole
  // point of the score is that it decides who gets the material.
  const scoreByUser = new Map<string, ReliabilityScore>();
  const spansByUser = new Map<string, ReservationSpan[]>();
  for (const row of reservations) {
    // Unclaimed bookings belong to nobody yet, so they feed no one's score.
    if (!row.user_id) continue;
    const list = spansByUser.get(row.user_id) ?? [];
    list.push(toSpan(row));
    spansByUser.set(row.user_id, list);
  }
  for (const userId of userIds) {
    scoreByUser.set(userId, computeReliability(spansByUser.get(userId) ?? [], today));
  }

  const queuePosition = new Map<string, number>();
  const waitGroups = new Map<string, FleetReservationRow[]>();
  for (const row of reservations) {
    if (row.status !== "waitlisted") continue;
    const key = `${row.asset_id}|${row.start_date}`;
    const group = waitGroups.get(key) ?? [];
    group.push(row);
    waitGroups.set(key, group);
  }
  for (const group of waitGroups.values()) {
    const ordered = orderQueue(
      group.map((row) => ({
        reservation_id: row.id,
        user_id: row.user_id ?? "",
        score: row.user_id ? (scoreByUser.get(row.user_id)?.score ?? 0) : 0,
        requested_at: row.created_at,
      })),
    );
    ordered.forEach((entry, index) => queuePosition.set(entry.reservation_id, index + 1));
  }

  const reservationViews: FleetReservationView[] = reservations.map((row) => {
    const span = toSpan(row);
    return {
      ...row,
      holder_name: row.user_id
        ? (names.get(row.user_id) ?? "Unknown")
        : (row.holder_label ?? "Unassigned"),
      is_mine: row.user_id === args.viewerId,
      due_date: dueDateOf(span),
      days_overdue: daysOverdue(span, today),
      queue_position: queuePosition.get(row.id) ?? null,
      unclaimed: row.user_id === null,
      imported: row.source === "sheet_import",
    };
  });

  const assetViews: FleetAssetView[] = assets.map((asset) => {
    const ageDays = asset.location_confirmed_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(`${today}T00:00:00Z`).getTime() -
              new Date(asset.location_confirmed_at).getTime()) /
              86_400_000,
          ),
        )
      : null;
    return {
      ...asset,
      holder_name: asset.current_holder_user_id
        ? (names.get(asset.current_holder_user_id) ?? asset.current_holder_label)
        : asset.current_holder_label,
      location_age_days: ageDays,
      location_stale: ageDays !== null && ageDays > STALE_LOCATION_DAYS,
    };
  });

  const standings = [...spansByUser.keys()]
    .map((userId) => ({
      user_id: userId,
      name: names.get(userId) ?? "Unknown",
      score: scoreByUser.get(userId) ?? computeReliability([], today),
    }))
    .sort((a, b) => b.score.score - a.score.score || a.name.localeCompare(b.name));

  const mine = scoreByUser.get(args.viewerId) ?? computeReliability([], today);

  // Names with live bookings and no account behind them. `mine` marks the ones
  // this viewer is allowed to claim without an admin — see
  // `holderLabelMatchesPerson`, which is deliberately strict about it.
  // Counts EVERY booking under the name, not just live ones. This list drives
  // the identity prompt, and someone whose bookings have all finished still owns
  // that history — filtering to live material would offer them nothing and quietly
  // strand six months of their record under a name nobody can claim.
  const unclaimedCounts = new Map<string, { label: string; count: number; live: number }>();
  for (const row of reservations) {
    if (row.user_id) continue;
    if (row.status === "cancelled") continue;
    const label = row.holder_label?.trim();
    if (!label) continue;
    const key = normalizeHolderLabel(label);
    const entry = unclaimedCounts.get(key) ?? { label, count: 0, live: 0 };
    entry.count += 1;
    if (isBlocking(row.status)) entry.live += 1;
    unclaimedCounts.set(key, entry);
  }
  // Names that appear only as an asset holder still need claiming — otherwise
  // someone with assigned kit but no bookings is invisible to both the identity
  // prompt and the admin's list.
  for (const asset of assets) {
    if (asset.current_holder_user_id) continue;
    const label = asset.current_holder_label?.trim();
    if (!label) continue;
    const key = normalizeHolderLabel(label);
    if (!unclaimedCounts.has(key)) {
      unclaimedCounts.set(key, { label, count: 0, live: 0 });
    }
  }

  // A holder that will never have an account is not "unclaimed", it is simply
  // not a person — offering "Total Energies" as a name to claim would be noise
  // that never goes away.
  const externalLabels = new Set(
    directory.filter((d) => d.kind === "external").map((d) => d.label),
  );
  for (const key of [...unclaimedCounts.keys()]) {
    if (externalLabels.has(key)) unclaimedCounts.delete(key);
  }

  const viewer = { name: args.viewerName ?? null, email: args.viewerEmail ?? null };
  const unclaimedHolders = [...unclaimedCounts.values()]
    .map((entry) => ({
      label: entry.label,
      count: entry.count,
      live: entry.live,
      mine: holderLabelMatchesPerson(entry.label, viewer),
    }))
    // The viewer's own names first, then whoever is holding the most material
    // right now, then the biggest histories.
    .sort(
      (a, b) =>
        Number(b.mine) - Number(a.mine) ||
        b.live - a.live ||
        b.count - a.count ||
        a.label.localeCompare(b.label),
    );

  return {
    today,
    window_start: windowStart,
    window_days: windowDays,
    assets: assetViews,
    reservations: reservationViews,
    me: { ...mine, user_id: args.viewerId },
    standings,
    unclaimed_holders: unclaimedHolders,
    reminders_enabled: remindersEnabled,
    identity_confirmed: (myAliasResult.data ?? []).length > 0,
    auto_linked: args.autoLinked ?? null,
    archived_assets: (archivedResult.data ?? []) as FleetAssetRow[],
  };
}

/**
 * Whether return reminders are switched on. Defaults to FALSE when the settings
 * row is missing or unreadable: the safe direction for something that mails
 * people is silence.
 */
export async function fetchRemindersEnabled(admin: AnySupabase): Promise<boolean> {
  const { data, error } = await admin
    .from("fleet_settings")
    .select("reminders_enabled")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return false;
  return data.reminders_enabled === true;
}

/** Resolves auth user ids to display names. Missing users degrade to "Unknown". */
/**
 * Short-lived cache of the user directory.
 *
 * `listUsers` is a GoTrue admin call that pulls the whole user table, and the
 * board needs it on every single load — including the refetch that follows every
 * booking, check-out and check-in, which is what made the module feel sticky
 * after each click. Display names change approximately never, so serving them
 * from a few seconds of cache is free.
 *
 * Per-instance and deliberately tiny: this is a latency cache, not a source of
 * truth. A cold start or a second instance simply refetches.
 */
const USER_NAME_TTL_MS = 30_000;
let userNameCache: { names: Map<string, string>; expiresAt: number } | null = null;

async function loadAllUserNames(admin: AnySupabase): Promise<Map<string, string>> {
  const now = Date.now();
  if (userNameCache && userNameCache.expiresAt > now) return userNameCache.names;

  const names = new Map<string, string>();
  // listUsers is the only admin API that returns metadata in bulk. The fleet is
  // an internal tool with a small user table, so one page is plenty; if the
  // workspace ever outgrows it, the unresolved ids simply render as "Unknown".
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  // Do not cache a failure: an outage would otherwise blank every name for the
  // whole TTL, and the caller already degrades to "Unknown" on its own.
  if (error || !data) return names;

  for (const user of data.users) {
    names.set(
      user.id,
      displayNameFor({ email: user.email, identities: user.identities }),
    );
  }
  userNameCache = { names, expiresAt: now + USER_NAME_TTL_MS };
  return names;
}

export async function fetchUserNames(admin: AnySupabase, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;

  const all = await loadAllUserNames(admin);
  for (const id of ids) {
    const name = all.get(id);
    if (name !== undefined) names.set(id, name);
  }
  return names;
}

/** All reservations for one user, for the score and "my material" list. */
export async function fetchUserSpans(admin: AnySupabase, userId: string): Promise<ReservationSpan[]> {
  const { data, error } = await admin
    .from("fleet_reservations")
    .select("id, asset_id, user_id, holder_label, source, start_date, end_date, status, returned_on")
    .eq("user_id", userId);
  if (error) throw new Error(`fleet_reservations read failed: ${error.message}`);
  return ((data ?? []) as FleetReservationRow[]).map(toSpan);
}

/** Live (blocking) reservations for one asset, for the conflict check. */
export async function fetchAssetSpans(admin: AnySupabase, assetId: string): Promise<ReservationSpan[]> {
  const { data, error } = await admin
    .from("fleet_reservations")
    .select("id, asset_id, user_id, holder_label, source, start_date, end_date, status, returned_on")
    .eq("asset_id", assetId);
  if (error) throw new Error(`fleet_reservations read failed: ${error.message}`);
  return ((data ?? []) as FleetReservationRow[]).map(toSpan);
}

/** The viewer's reliability, used to gate how far ahead they may book. */
export async function fetchReliability(admin: AnySupabase, userId: string, today: string) {
  return computeReliability(await fetchUserSpans(admin, userId), today);
}

/** Appends a movement/audit event. Never throws — an audit gap must not fail the write. */
export async function recordAssetEvent(
  admin: AnySupabase,
  event: {
    asset_id: string;
    reservation_id?: string | null;
    kind: string;
    actor_user_id?: string | null;
    from_location?: string | null;
    to_location?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("fleet_asset_events").insert(event);
  if (error) console.error("fleet_asset_events insert failed", error.message);
}

export { isBlocking, isBookable };


/* -------------------------------------------------------------------------- */
/* Holder directory                                                            */
/* -------------------------------------------------------------------------- */

export type HolderDirectoryEntry = {
  label: string;
  display_name: string;
  email: string | null;
  kind: "person" | "external";
};

/**
 * The name -> account mapping behind the fleet list.
 *
 * The list names holders by first name ("ASSIGNED (CHARLES)") while accounts
 * are emails, so the link is recorded rather than inferred — guessing from the
 * name works right up until two people share a first name.
 *
 * Returns an empty directory if the table is missing, so an install that has
 * not run the migration degrades to name matching rather than failing.
 */
export async function fetchHolderDirectory(admin: AnySupabase): Promise<HolderDirectoryEntry[]> {
  const { data, error } = await admin
    .from("fleet_holder_directory")
    .select("label, display_name, email, kind");
  if (error) return [];
  return (data ?? []) as HolderDirectoryEntry[];
}

/* -------------------------------------------------------------------------- */
/* Automatic identity linking                                                  */
/* -------------------------------------------------------------------------- */

export type AutoLinkResult =
  | { linked: false; reason: "already_confirmed" | "no_match" | "ambiguous"; candidates?: string[] }
  | { linked: true; label: string; bookings: number; assets: number };

/**
 * Links a signing-in user to their legacy holder name, when that can be done
 * without guessing.
 *
 * Runs on every board load until the person has an alias, so it catches both a
 * returning user and someone who has only just signed up — no separate hook on
 * the auth flow, and no way for a new account to slip past it.
 *
 * The whole safety of the loose first-or-last-name matching rests here: it
 * links ONLY when exactly one unclaimed name matches. Two colleagues called
 * Philipp both match "Philipp", so neither is auto-linked and the person is
 * asked instead. Names already mapped to somebody are never candidates.
 *
 * Silent on failure: an identity link is a convenience, and a board that will
 * not load because a name lookup failed is worse than one that asks the user.
 */
export async function autoLinkHolder(
  admin: AnySupabase,
  viewer: { id: string; name: string | null; email: string | null },
): Promise<AutoLinkResult> {
  try {
    // Candidates come from BOTH tables. Someone can hold assigned kit without
    // ever appearing in a booking, and reading only reservations would leave
    // them unmatched.
    const [{ data: mine }, { data: rows }, { data: assetRows }, { data: aliases }, directory] =
      await Promise.all([
        admin.from("fleet_holder_aliases").select("label").eq("user_id", viewer.id),
        admin
          .from("fleet_reservations")
          .select("holder_label")
          .is("user_id", null)
          .not("holder_label", "is", null),
        admin
          .from("fleet_assets")
          .select("current_holder_label")
          .eq("active", true)
          .is("current_holder_user_id", null)
          .not("current_holder_label", "is", null),
        admin.from("fleet_holder_aliases").select("label"),
        fetchHolderDirectory(admin),
      ]);

    // Having an alias already is NOT a reason to stop. The alias IS the mapping,
    // and applying it has to stay idempotent: a later import writes fresh rows
    // under the same name, and returning early here would leave them unclaimed
    // forever for exactly the people who had already said who they are.
    const myLabels = new Set((mine ?? []).map((a) => a.label as string));
    const confirmed = myLabels.size > 0;

    // Somebody else's alias is still off limits.
    const taken = new Set(
      (aliases ?? []).map((a) => a.label as string).filter((l) => !myLabels.has(l)),
    );
    const labels = new Map<string, string>();
    const collect = (raw: string | null | undefined) => {
      const label = raw?.trim();
      if (!label) return;
      const key = normalizeHolderLabel(label);
      if (!key || taken.has(key)) return;
      labels.set(key, label);
    };
    for (const row of rows ?? []) collect(row.holder_label as string | null);
    for (const row of assetRows ?? []) collect(row.current_holder_label as string | null);

    const person = { name: viewer.name, email: viewer.email };

    // The directory is the authority when it knows this email: an exact,
    // recorded mapping beats any name heuristic, and it is what makes two
    // colleagues sharing a first name resolvable at all.
    const viewerEmail = (viewer.email ?? "").trim().toLowerCase();
    const byEmail = viewerEmail
      ? directory.find((d) => d.kind === "person" && (d.email ?? "").toLowerCase() === viewerEmail)
      : undefined;

    // An external holder (a customer, a region) is nobody's to claim.
    const external = new Set(
      directory.filter((d) => d.kind === "external").map((d) => d.label),
    );
    for (const key of [...labels.keys()]) {
      if (external.has(key)) labels.delete(key);
    }

    // Once confirmed, only names this user actually owns apply — no fresh
    // guessing on someone who has already answered. Before that: the directory
    // if it knows them, otherwise a shared first or last name.
    const matches = confirmed
      ? [...labels.entries()].filter(([key]) => myLabels.has(key)).map(([, label]) => label)
      : byEmail
        ? [...labels.entries()]
            .filter(([key]) => key === byEmail.label)
            .map(([, label]) => label)
        : [...labels.values()].filter((label) => holderLabelMatchesPerson(label, person));

    if (matches.length === 0) {
      return { linked: false, reason: confirmed ? "already_confirmed" : "no_match" };
    }
    // Ambiguity only matters while guessing. A name they own, or one the
    // directory names outright, is never ambiguous.
    if (!confirmed && !byEmail && matches.length > 1) {
      return { linked: false, reason: "ambiguous", candidates: matches };
    }

    const label = matches[0];
    const key = normalizeHolderLabel(label);

    // Take the bookings filed under the name...
    const { data: claimed } = await admin
      .from("fleet_reservations")
      .update({ user_id: viewer.id })
      .is("user_id", null)
      .eq("holder_label", label)
      .select("id, asset_id");

    // ...and the assets whose holder is only a string.
    const { data: heldAssets } = await admin
      .from("fleet_assets")
      .select("id, current_holder_label")
      .is("current_holder_user_id", null)
      .not("current_holder_label", "is", null);
    const held = (heldAssets ?? []).filter(
      (a) => a.current_holder_label && normalizeHolderLabel(a.current_holder_label as string) === key,
    );
    if (held.length > 0) {
      await admin
        .from("fleet_assets")
        .update({ current_holder_user_id: viewer.id })
        .in("id", held.map((a) => a.id as string));
    }

    await admin.from("fleet_holder_aliases").upsert(
      { label: key, user_id: viewer.id, claimed_by: viewer.id, claimed_at: new Date().toISOString() },
      { onConflict: "label" },
    );

    return {
      linked: true,
      label,
      bookings: (claimed ?? []).length,
      assets: held.length,
    };
  } catch (error) {
    console.error("autoLinkHolder failed", error);
    return { linked: false, reason: "no_match" };
  }
}
