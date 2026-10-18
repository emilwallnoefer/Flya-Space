import type { FleetRequestView } from "@/lib/fleet-requests";
import type { ClosedReason, ReliabilityScore, ReservationSource, ReservationStatus } from "@/lib/fleet-rules";

export type { FleetRequestView };

/** Wire types for `/api/fleet`. Mirrors `src/lib/fleet-queries.ts`. */

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
export type FleetAssetStatus = "available" | "reserved" | "out" | "in_repair" | "retired";

/**
 * An archived unit, as the server actually sends it.
 *
 * The board computes `holder_name`, `location_age_days` and `location_stale`
 * for ACTIVE assets only; archived ones come back as the raw row. This type was
 * previously `FleetAsset`, which claimed three fields that are never there —
 * harmless only because the restore list happens to read none of them.
 */
export type FleetArchivedAsset = Omit<
  FleetAsset,
  "holder_name" | "location_age_days" | "location_stale"
>;

export type FleetAsset = {
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
  /** Admin-set slug grouping interchangeable units ("elios-3"); null = no siblings. */
  kind_key: string | null;
  holder_name: string | null;
  location_age_days: number | null;
  location_stale: boolean;
};

export type FleetReservation = {
  id: string;
  asset_id: string;
  /** Null while the booking is filed under a name with no account behind it. */
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
  /** Why the booking closed; null while live (see `ClosedReason`). */
  closed_reason: ClosedReason | null;
  created_at: string;
  holder_name: string;
  is_mine: boolean;
  due_date: string;
  days_overdue: number;
  queue_position: number | null;
  /** No account behind this booking yet. */
  unclaimed: boolean;
  /** Carried over from the spreadsheet: provisional, and excluded from scoring. */
  imported: boolean;
};

export type FleetBoardResponse = {
  today: string;
  window_start: string;
  window_days: number;
  assets: FleetAsset[];
  reservations: FleetReservation[];
  /** Extension requests the viewer asked or has to answer (admins: all). */
  requests: FleetRequestView[];
  me: ReliabilityScore & { user_id: string };
  standings: Array<{ user_id: string; name: string; score: ReliabilityScore }>;
  /** Holder names with live bookings and no account behind them. */
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
  /** True once this user has been through the one-time "which name is you?" step. */
  identity_confirmed: boolean;
  /** Set when this load linked the user to a legacy name automatically. */
  auto_linked: { label: string; bookings: number; assets: number } | null;
  /** Units removed from the fleet. Admin-only, so the Manage tab can restore one. */
  archived_assets: FleetArchivedAsset[];
  is_admin: boolean;
  /**
   * Set only when the fleet tables are missing and the app is not in production:
   * the board is sample data so the UI can be reviewed before the migration runs.
   */
  demo?: boolean;
};

export const CATEGORY_LABEL: Record<FleetAssetCategory, string> = {
  drone: "Drone fleet",
  lidar: "LiDAR Rev 7",
  rad_payload: "RAD payloads",
  ut_payload: "UT payloads",
  lel_payload: "LEL payloads",
  dummy_drone: "Dummy drones",
  tether: "Tethers",
  range_extender: "Range extenders",
  gcs: "Ground stations",
  accessory: "Accessories",
  other: "Other",
};

/**
 * Display order for category groups — the order the fleet sheet uses, which is
 * how people already think about the kit. Alphabetical would put "Dummy drones"
 * above the actual drone fleet.
 */
export const CATEGORY_ORDER: FleetAssetCategory[] = [
  "drone",
  "lidar",
  "rad_payload",
  "ut_payload",
  "lel_payload",
  "dummy_drone",
  "tether",
  "range_extender",
  "gcs",
  "accessory",
  "other",
];

/** Sort key for a category, for grouping lists and the calendar. */
export function categoryRank(category: FleetAssetCategory): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

export const STATUS_LABEL: Record<FleetAssetStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  out: "Out",
  in_repair: "In repair",
  retired: "Retired",
};
