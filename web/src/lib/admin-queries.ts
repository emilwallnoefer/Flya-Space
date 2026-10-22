import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInteger, toDateString } from "@/lib/time-tracker-queries";
import { normalizeUserRole, type UserRole } from "@/lib/user-role";
import { TIME_TRACKER_TARGET_MINS } from "@/lib/time-tracker-rules";
import { readModuleGrants } from "@/lib/role-access";
import { isAdminEmail } from "@/lib/admin";

/**
 * Shared read helpers for the Admin panel's user table and time overview.
 *
 * These run against the service-role admin client, so every caller must first
 * pass `guardAdmin()` (users) or `guardTimeViewer()` (time overview) — or, for
 * the SSR prefetch on the dashboard, confirm the acting user is an admin via
 * `isAdminEmail()` before calling. They mirror what `/api/admin/users` and
 * `/api/admin/time-overview` return so the panel can be seeded server-side.
 */

export type AdminListedUser = {
  id: string;
  email: string;
  role: UserRole | null;
  /** An admin switched the Time Tracker on for this person (app_metadata.module_grants). */
  time_access: boolean;
  /** In ADMIN_EMAILS: every module is included, whatever the role. */
  is_admin: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export type AdminTimeOverviewUser = {
  user_id: string;
  email: string;
  role: UserRole | null;
  weekly_total_mins: number;
  overtime_bank_mins: number;
  missing_days: number;
  target_mins: number;
  error?: string;
};

export type AdminTimeOverview = {
  week_start: string;
  users: AdminTimeOverviewUser[];
};

type OverviewRow = {
  user_id: string;
  weekly_total_mins: number | string | null;
  missing_days: number | string | null;
  overtime_bank_mins: number | string | null;
  target_mins: number | string | null;
};

function extractRole(metadata: unknown): UserRole | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  return normalizeUserRole(record.role);
}

/**
 * List every auth user (paginated) with their role from app_metadata.
 * `admin` must be a service-role client and the caller must be an admin.
 */
export async function fetchAdminUsers(admin: SupabaseClient): Promise<AdminListedUser[]> {
  const users: AdminListedUser[] = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const pageUsers = data?.users ?? [];
    for (const user of pageUsers) {
      users.push({
        id: user.id,
        email: user.email ?? "",
        role: extractRole(user.app_metadata),
        time_access: readModuleGrants(user.app_metadata).includes("time"),
        is_admin: isAdminEmail(user.email),
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
      });
    }
    if (pageUsers.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  users.sort((a, b) => a.email.localeCompare(b.email));
  return users;
}

/**
 * Aggregate weekly totals / overtime bank / missing days per user for a week.
 * `admin` must be a service-role client and the caller must be an admin or HR.
 */
export async function fetchAdminTimeOverview(
  admin: SupabaseClient,
  weekStartDate: Date,
): Promise<AdminTimeOverview> {
  const weekStartKey = toDateString(weekStartDate);

  const users: Array<{ id: string; email: string; role: UserRole | null }> = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const pageUsers = data?.users ?? [];
    for (const user of pageUsers) {
      users.push({ id: user.id, email: user.email ?? "", role: extractRole(user.app_metadata) });
    }
    if (pageUsers.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }

  const overviewRes = await admin.rpc("tt_admin_overview", { p_week_start: weekStartKey });
  let overviewByUserId = new Map<string, OverviewRow>();
  let aggregateError: string | null = null;
  if (overviewRes.error) {
    aggregateError = overviewRes.error.message || "Failed to load overview aggregates.";
  } else {
    overviewByUserId = new Map(
      ((overviewRes.data as OverviewRow[] | null) ?? []).map((row) => [row.user_id, row]),
    );
  }

  const summaries: AdminTimeOverviewUser[] = users.map((user) => {
    const row = overviewByUserId.get(user.id);
    if (!row) {
      return {
        user_id: user.id,
        email: user.email,
        role: user.role,
        weekly_total_mins: 0,
        overtime_bank_mins: 0,
        missing_days: 0,
        target_mins: TIME_TRACKER_TARGET_MINS,
        ...(aggregateError ? { error: aggregateError } : {}),
      };
    }
    return {
      user_id: user.id,
      email: user.email,
      role: user.role,
      weekly_total_mins: parseInteger(row.weekly_total_mins),
      overtime_bank_mins: parseInteger(row.overtime_bank_mins),
      missing_days: parseInteger(row.missing_days),
      target_mins: parseInteger(row.target_mins, TIME_TRACKER_TARGET_MINS),
    };
  });

  summaries.sort((a, b) => a.email.localeCompare(b.email));

  return { week_start: weekStartKey, users: summaries };
}
