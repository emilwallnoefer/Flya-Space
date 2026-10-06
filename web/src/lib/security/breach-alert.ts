import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminEmails } from "@/lib/admin";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { readWorkspaceSettings } from "@/lib/workspace-settings";
import type { SecurityEventInput, SecuritySeverity } from "@/lib/security/security-events";

/**
 * Breach notification. Evaluates a just-recorded security event and, if it
 * looks like an incident an admin should know about, emails every address in
 * ADMIN_EMAILS via Resend. Best-effort and non-throwing — alerting must never
 * fail the request that triggered it.
 *
 * Alerting fires when either:
 *   - the event severity is `critical`, or
 *   - the same actor produced >= `security_alert_threshold` `failed_admin_access`
 *     events within the lookback window (probing an admin route).
 *
 * A global debounce (`security_alert_last_sent_at` + COOLDOWN_MS) prevents an
 * email storm: at most one alert per cooldown window, regardless of volume.
 */

const LOOKBACK_MS = 15 * 60 * 1000; // count recent failures over 15 minutes
const COOLDOWN_MS = 30 * 60 * 1000; // at most one alert per 30 minutes

type AlertDecision =
  | { alert: false }
  | { alert: true; reason: string };

async function decide(
  admin: SupabaseClient,
  event: SecurityEventInput,
  severity: SecuritySeverity,
  threshold: number,
): Promise<AlertDecision> {
  if (severity === "critical") {
    return { alert: true, reason: `critical security event (${event.kind})` };
  }

  if (event.kind === "failed_admin_access" && event.actor_email) {
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const { count, error } = await admin
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "failed_admin_access")
      .eq("actor_email", event.actor_email)
      .gte("created_at", since);
    if (error) {
      console.error("breach-alert threshold query failed", error);
      return { alert: false };
    }
    if ((count ?? 0) >= threshold) {
      return {
        alert: true,
        reason: `${count} blocked admin-route attempts from ${event.actor_email} in the last 15 minutes`,
      };
    }
  }

  return { alert: false };
}

function renderEmail(reason: string, event: SecurityEventInput) {
  const when = new Date().toISOString();
  const lines = [
    `A security alert was triggered in the Flya Space dashboard.`,
    ``,
    `Reason: ${reason}`,
    `Event: ${event.kind} (severity ${event.severity ?? "warning"})`,
    `Actor: ${event.actor_email ?? "unknown"}`,
    `IP: ${event.ip ?? "unknown"}`,
    `Time: ${when}`,
    ``,
    `Review the full log under Admin → Security in the dashboard.`,
  ];
  const text = lines.join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">` +
    `<h2 style="margin:0 0 12px">⚠️ Security alert</h2>` +
    `<p style="margin:0 0 12px"><strong>${esc(reason)}</strong></p>` +
    `<table style="border-collapse:collapse">` +
    `<tr><td style="padding:2px 12px 2px 0;color:#666">Event</td><td>${esc(event.kind)} (severity ${esc(event.severity ?? "warning")})</td></tr>` +
    `<tr><td style="padding:2px 12px 2px 0;color:#666">Actor</td><td>${esc(event.actor_email ?? "unknown")}</td></tr>` +
    `<tr><td style="padding:2px 12px 2px 0;color:#666">IP</td><td>${esc(event.ip ?? "unknown")}</td></tr>` +
    `<tr><td style="padding:2px 12px 2px 0;color:#666">Time</td><td>${esc(when)}</td></tr>` +
    `</table>` +
    `<p style="margin:12px 0 0;color:#666">Review the full log under Admin → Security in the dashboard.</p>` +
    `</div>`;
  return { text, html };
}

/**
 * Evaluate an event and send breach-alert emails if warranted. Never throws.
 * Returns a small status object (useful for tests / manual triggers).
 */
export async function maybeAlertAdmins(
  admin: SupabaseClient,
  event: SecurityEventInput & { severity?: SecuritySeverity },
): Promise<{ sent: boolean; reason?: string; skipped?: string }> {
  try {
    const settings = await readWorkspaceSettings(admin);
    if (!settings.security_alerts_enabled) {
      return { sent: false, skipped: "alerts_disabled" };
    }

    const severity = event.severity ?? "warning";
    const decision = await decide(admin, event, severity, settings.security_alert_threshold);
    if (!decision.alert) return { sent: false, skipped: "below_threshold" };

    // Debounce: at most one alert per cooldown window.
    const lastSent = settings.security_alert_last_sent_at
      ? new Date(settings.security_alert_last_sent_at).getTime()
      : 0;
    if (Date.now() - lastSent < COOLDOWN_MS) {
      return { sent: false, skipped: "debounced", reason: decision.reason };
    }

    if (!isResendConfigured()) {
      return { sent: false, skipped: "resend_not_configured", reason: decision.reason };
    }

    const recipients = getAdminEmails();
    if (recipients.length === 0) {
      return { sent: false, skipped: "no_admins", reason: decision.reason };
    }

    // Claim the debounce window before sending so concurrent invocations don't
    // both fire (best-effort — the update is idempotent on the singleton row).
    await admin
      .from("workspace_settings")
      .update({ security_alert_last_sent_at: new Date().toISOString() })
      .eq("id", 1);

    const { text, html } = renderEmail(decision.reason, { ...event, severity });
    await Promise.all(
      recipients.map((to) =>
        sendEmailViaResend({
          to,
          subject: "⚠️ Flya Space security alert",
          text,
          html,
        }),
      ),
    );

    return { sent: true, reason: decision.reason };
  } catch (error) {
    console.error("maybeAlertAdmins threw", error);
    return { sent: false, skipped: "error" };
  }
}
