"use client";

import { use, useState } from "react";
import { fmtHM, fmtSignedHM } from "@/components/time-tracker/types";
import type { AdminListedUser, AdminTimeOverview } from "@/lib/admin-queries";
import { addDays, fromDateKey, getMonday, toDateKey } from "@/lib/date";
import { userRoleLabel } from "@/lib/user-role";
import { cn } from "@/lib/cn";
import { ChevronIcon, MobileEmpty, MobileGroup, MobileRow, MobileSegmented, MobileTopBar } from "../primitives";
import { MobileTimeScreen } from "../time/mobile-time-screen";
import { useAdminTimeOverview, useAdminUsers } from "./use-admin-data";

type AdminView = "time" | "users";

/**
 * Admin on the phone, read-only: the team's week (tap a person for their
 * week as a list) and the user list with roles. Everything else in Admin —
 * mail tracking, audit, security, reminders, settings, role changes — stays
 * on desktop; the More menu says so.
 */
export function MobileAdminScreen({
  canManageUsers,
  initialUsers,
  initialOverview,
  onBack,
}: {
  canManageUsers: boolean;
  initialUsers: Promise<AdminListedUser[] | null>;
  initialOverview: Promise<AdminTimeOverview | null>;
  onBack: () => void;
}) {
  const seededUsers = use(initialUsers);
  const seededOverview = use(initialOverview);
  const [view, setView] = useState<AdminView>("time");
  const [drill, setDrill] = useState<{ id: string; email: string } | null>(null);
  const overviewState = useAdminTimeOverview(seededOverview);
  const usersState = useAdminUsers(seededUsers, canManageUsers && view === "users");

  if (drill) {
    return (
      <>
        <MobileTopBar title={drill.email || "Team member"} onBack={() => setDrill(null)} />
        <p className="px-4 pb-2 text-xs text-ink-4">Read-only view</p>
        <MobileTimeScreen initialWeek={null} readOnly apiBase={`/api/admin/time-user?user_id=${encodeURIComponent(drill.id)}`} />
      </>
    );
  }

  const { weekStart, setWeekStart, overview, loading, error } = overviewState;
  const monday = fromDateKey(weekStart);
  const sunday = addDays(monday, 6);
  const weekLabel = `${monday.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${sunday.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  const isCurrentWeek = weekStart === toDateKey(getMonday());

  return (
    <>
      <MobileTopBar title={canManageUsers ? "Admin" : "Team time"} onBack={onBack} />
      <div className="space-y-4 px-4 pt-1">
        {canManageUsers ? (
          <MobileSegmented
            label="Admin view"
            value={view}
            onChange={setView}
            options={[
              { value: "time", label: "Team time" },
              { value: "users", label: "Users" },
            ]}
          />
        ) : null}

        {view === "time" ? (
          <>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setWeekStart(toDateKey(addDays(monday, -7)))} aria-label="Previous week" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
                <ChevronIcon className="h-5 w-5 rotate-180" />
              </button>
              <div className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center">
                <span className="text-[15px] font-semibold text-ink">{weekLabel}</span>
                <span className="text-[11px] text-ink-4">{isCurrentWeek ? "This week" : loading ? "Loading…" : "Tap a person for their days"}</span>
              </div>
              <button type="button" onClick={() => setWeekStart(toDateKey(addDays(monday, 7)))} aria-label="Next week" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
                <ChevronIcon className="h-5 w-5" />
              </button>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <MobileGroup title="Everyone">
              {loading && !overview ? (
                <MobileEmpty>Loading overview…</MobileEmpty>
              ) : !overview || overview.users.length === 0 ? (
                <MobileEmpty>No users found.</MobileEmpty>
              ) : (
                overview.users.map((user) => (
                  <button key={user.user_id} type="button" onClick={() => setDrill({ id: user.user_id, email: user.email })} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-glass/8">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-ink">{user.email || user.user_id}</span>
                      <span className="block text-xs text-ink-4">
                        {userRoleLabel(user.role)}
                        {user.error ? <span className="text-danger"> · {user.error}</span> : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-ink">{fmtHM(user.weekly_total_mins)}</span>
                      <span className={cn("block text-[11px] tabular-nums", user.missing_days > 0 ? "text-danger" : "text-ink-4")}>
                        {user.missing_days > 0 ? `${user.missing_days} missing` : fmtSignedHM(user.overtime_bank_mins)}
                      </span>
                    </span>
                    <ChevronIcon className="h-4 w-4 shrink-0 text-ink-5" />
                  </button>
                ))
              )}
            </MobileGroup>
          </>
        ) : (
          <>
            {usersState.error ? <p className="text-sm text-danger">{usersState.error}</p> : null}
            <MobileGroup title={`${usersState.users.length} accounts`} trailing={<span className="text-[11px] text-ink-5">Change roles on desktop</span>}>
              {usersState.loading && usersState.users.length === 0 ? (
                <MobileEmpty>Loading users…</MobileEmpty>
              ) : usersState.users.length === 0 ? (
                <MobileEmpty>No users found.</MobileEmpty>
              ) : (
                usersState.users.map((user) => (
                  <MobileRow
                    key={user.id}
                    label={user.email || user.id}
                    detail={user.last_sign_in_at ? `Last sign-in ${new Date(user.last_sign_in_at).toLocaleDateString()}` : "Never signed in"}
                    value={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", user.role ? "bg-glass/10 text-ink-3" : "bg-rose-500/15 text-danger")}>{userRoleLabel(user.role)}</span>}
                  />
                ))
              )}
            </MobileGroup>
          </>
        )}
      </div>
    </>
  );
}
