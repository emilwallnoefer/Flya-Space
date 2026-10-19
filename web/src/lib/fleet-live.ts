"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Live Fleet board: a "something changed" ping, nothing more.
 *
 * A statement trigger on the fleet tables (supabase/2026-10-19-fleet-live-board.sql)
 * broadcasts an empty `changed` event on this private topic after every write —
 * from /api/fleet, the cron or an admin route alike. The ping carries no rows on
 * purpose: what a viewer may see (their own requests, admins all) is decided by
 * GET /api/fleet, so the open board just refetches through it.
 */
export const FLEET_REALTIME_TOPIC = "fleet:board";
export const FLEET_CHANGED_EVENT = "changed";

/**
 * Calls `onChange` for every ping, and once more after each reconnect (a ping
 * sent while the socket was down is lost, so assume one was). Returns the
 * unsubscribe. Failing to connect is silent: the board still works, it is just
 * not live until the next reload.
 */
export function subscribeToFleetChanges(onChange: () => void): () => void {
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createClient();
  } catch {
    return () => {};
  }
  // Private: joining is authorised by the realtime.messages policy (role
  // holders only), the same as the team chat channel.
  const channel = supabase.channel(FLEET_REALTIME_TOPIC, { config: { private: true } });
  channel.on("broadcast", { event: FLEET_CHANGED_EVENT }, () => onChange());

  let subscribedOnce = false;
  channel.subscribe((status) => {
    if (status !== "SUBSCRIBED") return;
    if (subscribedOnce) onChange();
    subscribedOnce = true;
  });

  return () => {
    void supabase.removeChannel(channel);
  };
}
