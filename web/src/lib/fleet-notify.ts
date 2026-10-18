import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { renderFleetNotice, type FleetNoticeInput } from "@/lib/fleet-notices";
import { fetchUserContacts, recordAssetEvent } from "@/lib/fleet-queries";
import { pushToUsers } from "@/lib/push/notify-users";
import { isPushConfigured } from "@/lib/push/send";

/**
 * Delivers one Fleet notice to one or more people, once.
 *
 * ONCE-ONLY. `fleet_notice_sends` is claimed (reservation, recipient, kind,
 * date) BEFORE anything is pushed or mailed; a lost insert means this exact
 * notice already went out today. Same shape as `fleet_reminder_sends` and
 * `push_reminder_sends`.
 *
 * CHANNELS. A push to every device the person has switched on; an e-mail
 * only when they have NO device (the mail is the fallback, not a duplicate).
 * Someone who turned Fleet notices off in Settings gets neither, and the row
 * says so.
 *
 * BEST EFFORT. Called from request handlers and the daily cron after the real
 * write has happened; nothing the caller does depends on the outcome, and a
 * missing migration (42P01) is a warning, not an error.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export type FleetNoticeOutcome =
  | "pushed"
  | "emailed"
  | "already_sent"
  | "opted_out"
  | "no_channel"
  | "table_missing"
  | "failed";

export type FleetNoticeResult = { recipient_id: string; outcome: FleetNoticeOutcome };

let warnedMissingTable = false;

export async function sendFleetNotice(
  admin: AnySupabase,
  args: {
    input: FleetNoticeInput;
    /** The booking the claim is keyed on (usually the reader's own). */
    reservationId: string;
    assetId: string;
    recipientIds: string[];
    /** Dedupe date: today for event notices; see the migration for the two-day warning. */
    sentForDate: string;
    /** Absolute origin for the e-mail link. */
    origin: string;
    actorUserId?: string | null;
  },
): Promise<FleetNoticeResult[]> {
  const recipients = [...new Set(args.recipientIds)].filter(Boolean);
  if (recipients.length === 0) return [];

  const rendered = renderFleetNotice(args.input, args.origin);
  const contacts = await fetchUserContacts(admin, recipients);
  const results: FleetNoticeResult[] = [];

  for (const recipientId of recipients) {
    // CLAIM FIRST.
    const { error: claimError } = await admin.from("fleet_notice_sends").insert({
      reservation_id: args.reservationId,
      recipient_id: recipientId,
      kind: args.input.kind,
      sent_for_date: args.sentForDate,
      status: "sending",
    });
    if (claimError) {
      if (claimError.code === "23505") {
        results.push({ recipient_id: recipientId, outcome: "already_sent" });
        continue;
      }
      if (claimError.code === "42P01") {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.warn("[fleet-notify] fleet_notice_sends is missing — apply supabase/2026-10-19-fleet-edge-cases-3.sql.");
        }
        results.push({ recipient_id: recipientId, outcome: "table_missing" });
        continue;
      }
      console.warn("[fleet-notify] claim failed:", claimError.message);
      results.push({ recipient_id: recipientId, outcome: "failed" });
      continue;
    }

    const contact = contacts.get(recipientId);
    let outcome: FleetNoticeOutcome = "no_channel";
    let error: string | null = null;

    if (contact && !contact.fleetNotices) {
      outcome = "opted_out";
    } else {
      try {
        const push = isPushConfigured()
          ? await pushToUsers(admin, [recipientId], rendered.push, { ttlSeconds: 24 * 60 * 60 })
          : null;
        if (push && push.sent > 0) {
          outcome = "pushed";
        } else if (push && push.usersWithDevice.has(recipientId)) {
          // They have a device, but every send failed: the push service is the
          // problem, not the person. Mail would double up once it recovers.
          outcome = "failed";
          error = push.errors.join("; ") || "push failed";
        } else if (contact?.email && isResendConfigured()) {
          const mail = await sendEmailViaResend({ to: contact.email, ...rendered.email });
          if (mail.ok) outcome = "emailed";
          else {
            outcome = "failed";
            error = mail.error;
          }
        }
      } catch (err) {
        outcome = "failed";
        error = (err as Error).message;
      }
    }

    await admin
      .from("fleet_notice_sends")
      .update({ status: outcome, error, updated_at: new Date().toISOString() })
      .eq("reservation_id", args.reservationId)
      .eq("recipient_id", recipientId)
      .eq("kind", args.input.kind)
      .eq("sent_for_date", args.sentForDate);

    if (outcome === "pushed" || outcome === "emailed") {
      await recordAssetEvent(admin, {
        asset_id: args.assetId,
        reservation_id: args.reservationId,
        kind: "notice_sent",
        actor_user_id: args.actorUserId ?? null,
        note: `Told ${contact?.name ?? "someone"} (${outcome === "pushed" ? "push" : "e-mail"}): ${rendered.push.title}`,
      });
    }
    results.push({ recipient_id: recipientId, outcome });
  }
  return results;
}
