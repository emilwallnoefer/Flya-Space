import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Application-level admin action types. Keep these stable — the UI maps them to
 * human labels. Distinct from the DB-trigger `time_tracker_audit_log`.
 */
export type AdminAuditAction =
  | "role_change"
  | "reminder_pause"
  | "reminder_resume"
  | "mail_brief_model_change"
  | "security_alerts_change"
  // Fleet holder claims. Claiming a free-text name is deliberately permissive,
  // so the correction an admin makes afterwards is the accountable step: who
  // moved somebody else's material, and where to.
  | "fleet_holder_reassign"
  | "fleet_holder_release"
  // Field stats: whose Google connection reads the planning sheet, and the
  // salesperson → region map behind the regions chart.
  | "field_stats_settings_change"
  // Read, not a write. Viewing one employee's day-level time record exposes
  // sick leave, break names and free-text comp notes, so who looked at whose
  // record is worth an accountable trail even though nothing changed.
  // See `guardTimeViewer` in admin-guard.ts.
  | "employee_record_view";

export type AdminAuditEntry = {
  id: number;
  actor_email: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Best-effort insert into `admin_audit_log`. Deliberately never throws: an
 * audit write must not be able to fail the mutation it accompanies (a role
 * change should still succeed even if the audit table is missing or the insert
 * errors). Failures are logged server-side only.
 */
export async function recordAdminAudit(
  admin: SupabaseClient,
  entry: {
    actor_email: string | null;
    action: AdminAuditAction;
    target?: string | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      actor_email: entry.actor_email,
      action: entry.action,
      target: entry.target ?? null,
      detail: entry.detail ?? null,
    });
    if (error) {
      console.error("admin_audit_log insert failed", error);
    }
  } catch (error) {
    console.error("admin_audit_log insert threw", error);
  }
}
