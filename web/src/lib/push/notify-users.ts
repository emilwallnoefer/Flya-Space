import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPushConfigured, sendPush, type PushPayload, type PushSubscriptionRow } from "@/lib/push/send";

/**
 * The one loop every push sender needs: deliver a payload to a set of
 * devices, delete the subscriptions the push service reports gone, and stamp
 * `last_used_at` on the ones that worked. It used to be copied into each
 * sender (the Friday reminder, chat mentions, the phone-tour notice); now they
 * all call this, so a fix to the pruning lands everywhere at once.
 *
 * Service-role only: reading other people's `push_subscriptions` rows needs it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export type DeviceRow = PushSubscriptionRow & { id: string; user_id: string };

export type PushBatchResult = {
  /** Devices that accepted the push. */
  sent: number;
  /** Devices considered (before pruning). */
  devices: number;
  /** Devices the push service said no longer exist; their rows are deleted. */
  gone: number;
  failed: number;
  /** Failure messages, deduplicated, for the caller's log line. */
  errors: string[];
  /** Users who had at least one device, whether or not it accepted the push. */
  usersWithDevice: Set<string>;
};

const EMPTY: Omit<PushBatchResult, "usersWithDevice"> = { sent: 0, devices: 0, gone: 0, failed: 0, errors: [] };

/** Pushes to devices the caller already loaded; prunes and stamps as above. */
export async function pushToDevices(
  admin: AnySupabase,
  devices: DeviceRow[],
  payload: PushPayload,
  options: { ttlSeconds?: number } = {},
): Promise<PushBatchResult> {
  const usersWithDevice = new Set(devices.map((d) => d.user_id));
  if (devices.length === 0) return { ...EMPTY, usersWithDevice };

  let sent = 0;
  const goneIds: string[] = [];
  const errors = new Set<string>();
  await Promise.all(
    devices.map(async (device) => {
      const result = await sendPush(device, payload, options);
      if (result.ok) sent += 1;
      else if (result.gone) goneIds.push(device.id);
      else errors.add(result.error);
    }),
  );
  if (goneIds.length > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", goneIds);
    if (error) console.error("[push] pruning dead subscriptions failed", error.message);
  }
  if (sent > 0) {
    const okIds = devices.filter((d) => !goneIds.includes(d.id)).map((d) => d.id);
    await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", okIds);
  }
  return {
    sent,
    devices: devices.length,
    gone: goneIds.length,
    failed: devices.length - sent - goneIds.length,
    errors: [...errors],
    usersWithDevice,
  };
}

/**
 * Pushes to every device of the given users. Returns the empty result (and no
 * query) when nobody is targeted or push is not configured, so callers can
 * fall back to another channel by looking at `usersWithDevice`.
 */
export async function pushToUsers(
  admin: AnySupabase,
  userIds: string[],
  payload: PushPayload,
  options: { ttlSeconds?: number } = {},
): Promise<PushBatchResult> {
  const targets = [...new Set(userIds)].filter(Boolean);
  if (targets.length === 0 || !isPushConfigured()) return { ...EMPTY, usersWithDevice: new Set() };

  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", targets);
  if (error) {
    console.warn("[push] could not read subscriptions:", error.message);
    return { ...EMPTY, errors: [error.message], usersWithDevice: new Set() };
  }
  return pushToDevices(admin, (data ?? []) as DeviceRow[], payload, options);
}
