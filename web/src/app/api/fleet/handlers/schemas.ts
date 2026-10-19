import { z } from "zod";

/**
 * Every payload `/api/fleet` accepts.
 *
 * Kept in one module so the shapes stay next to each other: the Manage screen
 * shares `assetFields` between create and update, and the discriminated union
 * at the bottom is the single place that says which actions exist at all.
 */

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const reserveSchema = z.object({
  action: z.literal("reserve"),
  asset_id: z.string().uuid(),
  start_date: dateKey,
  end_date: dateKey,
  purpose: z.string().trim().max(280).optional(),
  destination: z.string().trim().max(160).optional(),
  /** Join the waitlist instead of failing when the week is taken. */
  waitlist: z.boolean().optional(),
});

const cancelSchema = z.object({
  action: z.literal("cancel"),
  reservation_id: z.string().uuid(),
});

const checkOutSchema = z.object({
  action: z.literal("check_out"),
  reservation_id: z.string().uuid(),
  location: z.string().trim().max(160).optional(),
});

const checkInSchema = z.object({
  action: z.literal("check_in"),
  reservation_id: z.string().uuid(),
  location: z.string().trim().max(160).optional(),
  note: z.string().trim().max(280).optional(),
  /**
   * The day the material actually came back, when that was before today —
   * material dropped on the shelf on Friday and checked in on Monday was not
   * three days late. Bounded by the handler to [start_date, today].
   */
  returned_on: dateKey.optional(),
});

const moveSchema = z.object({
  action: z.literal("move"),
  asset_id: z.string().uuid(),
  location: z.string().trim().min(1).max(160),
  note: z.string().trim().max(280).optional(),
});

const confirmSchema = z.object({
  action: z.literal("confirm_location"),
  asset_id: z.string().uuid(),
});

const claimHolderSchema = z.object({
  action: z.literal("claim_holder"),
  /** The free-text holder name to take ownership of. */
  label: z.string().trim().min(1).max(160),
  /** Admin only: assign the name to somebody else instead of yourself. */
  user_id: z.string().uuid().optional(),
});

const assignSchema = z.object({
  action: z.literal("assign"),
  asset_id: z.string().uuid(),
  /** Who it goes to. A free-text name is fine — they may not have an account. */
  holder_label: z.string().trim().min(1).max(160),
  location: z.string().trim().max(160).optional(),
  note: z.string().trim().max(280).optional(),
});

const returnToPoolSchema = z.object({
  action: z.literal("return_to_pool"),
  asset_id: z.string().uuid(),
  location: z.string().trim().max(160).optional(),
  note: z.string().trim().max(280).optional(),
});

const registerMemberSchema = z.object({
  action: z.literal("register_member"),
});

const setRemindersSchema = z.object({
  action: z.literal("set_reminders"),
  enabled: z.boolean(),
});

const ASSET_CATEGORIES = [
  "drone", "lidar", "rad_payload", "ut_payload", "lel_payload",
  "dummy_drone", "tether", "range_extender", "gcs", "accessory", "other",
] as const;

const ASSET_STATUSES = ["available", "reserved", "out", "in_repair", "retired"] as const;

/** Fields an admin can set on a piece of material. Shared by create and update. */
const assetFields = {
  name: z.string().trim().min(1).max(120),
  serial_number: z.string().trim().max(120).nullable().optional(),
  category: z.enum(ASSET_CATEGORIES),
  model: z.string().trim().max(120).nullable().optional(),
  owner_group: z.string().trim().max(120).nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  /** true = shared bookable pool (calendar); false = assigned to someone. */
  pooled: z.boolean().optional(),
  home_location: z.string().trim().max(160).nullable().optional(),
  current_location: z.string().trim().max(160).nullable().optional(),
  current_holder_label: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

const createAssetSchema = z.object({ action: z.literal("create_asset"), ...assetFields });

/** Move a booking to another unit for the same days (own booking, not yet picked up). */
const moveBookingSchema = z.object({
  action: z.literal("move_booking"),
  reservation_id: z.string().uuid(),
  asset_id: z.string().uuid(),
});

const updateAssetSchema = z.object({
  action: z.literal("update_asset"),
  asset_id: z.string().uuid(),
  name: assetFields.name.optional(),
  serial_number: assetFields.serial_number,
  category: assetFields.category.optional(),
  model: assetFields.model,
  owner_group: assetFields.owner_group,
  status: assetFields.status,
  pooled: assetFields.pooled,
  home_location: assetFields.home_location,
  current_location: assetFields.current_location,
  current_holder_label: assetFields.current_holder_label,
  notes: assetFields.notes,
});

const archiveAssetSchema = z.object({
  action: z.literal("archive_asset"),
  asset_id: z.string().uuid(),
  /** false restores a previously archived unit. */
  archived: z.boolean().default(true),
});

const setStatusSchema = z.object({
  action: z.literal("set_status"),
  asset_id: z.string().uuid(),
  status: z.enum(["available", "reserved", "out", "in_repair", "retired"]),
  note: z.string().trim().max(280).optional(),
});

/** Move a booking's last day. Shortens freely; extends when free, else files requests. */
const changeDatesSchema = z.object({
  action: z.literal("change_dates"),
  reservation_id: z.string().uuid(),
  end_date: dateKey,
});

/**
 * The recipient's answer to a request: `shorten` / `cancel` / `decline` for an
 * extension, `approve` / `decline` for a borrow. The handler refuses a reply
 * that does not fit the request's kind.
 */
const respondRequestSchema = z.object({
  action: z.literal("respond_request"),
  request_id: z.string().uuid(),
  reply: z.enum(["shorten", "cancel", "decline", "approve"]),
});

export const postSchema = z.discriminatedUnion("action", [
  reserveSchema,
  cancelSchema,
  checkOutSchema,
  checkInSchema,
  changeDatesSchema,
  respondRequestSchema,
  moveBookingSchema,
  moveSchema,
  confirmSchema,
  setStatusSchema,
  claimHolderSchema,
  setRemindersSchema,
  assignSchema,
  returnToPoolSchema,
  createAssetSchema,
  updateAssetSchema,
  archiveAssetSchema,
  registerMemberSchema,
]);

export type PostPayload = z.infer<typeof postSchema>;

/** Narrows the union to one action's payload, e.g. `FleetPayload<"reserve">`. */
export type FleetPayload<A extends PostPayload["action"]> = Extract<PostPayload, { action: A }>;
