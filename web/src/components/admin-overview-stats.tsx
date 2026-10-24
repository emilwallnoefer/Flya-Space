"use client";

import { Notice } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { FreshnessPill } from "@/components/freshness-pill";
import { userRoleLabel, type UserRole } from "@/lib/user-role";
import { fmtPct, fmtRelative } from "@/lib/admin-format";

type Insights = {
  generated_at: string;
  reminders: {
    total_logged: number;
    last_cron_run:
      | { sent_at: string; sent: number; failed: number; skipped_dry_run: number }
      | null;
    last_7_days: { sent: number; failed: number; skipped_dry_run: number };
    last_30_days: { sent: number; failed: number; skipped_dry_run: number; total: number };
    failure_rate_30d: number;
    top_reminded_90d: Array<{ email: string; count: number }>;
  };
  workspace: {
    total_users: number;
    users_by_role: Record<string, number>;
    active_last_7_days: number;
    hours_logged_last_7_days: number;
    hours_logged_this_month: number;
  };
};

type MailTotals = { sends_count: number; real_clicks: number; bot_clicks: number };

const ROLE_ORDER: Array<UserRole | "none"> = ["sales", "eu_pilot", "us_pilot", "hr", "none"];

function StatCard({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  info?: string;
}) {
  return (
    <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] uppercase tracking-[0.15em] text-ink-4/80">{label}</p>
        {info ? <InfoTooltip label={`About ${label}`}>{info}</InfoTooltip> : null}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-4">{hint}</p> : null}
    </div>
  );
}

async function requestInsights(): Promise<{ insights: Insights; mailRes: Response }> {
  const [insightsRes, mailRes] = await Promise.all([
    fetch("/api/admin/insights", { cache: "no-store" }),
    fetch("/api/admin/mail-tracking/overview-stats?days=90", { cache: "no-store" }),
  ]);
  const payload = (await insightsRes.json()) as Insights | { error: string };
  if (!insightsRes.ok) {
    throw new Error((payload as { error: string }).error || "Failed to load insights.");
  }
  return { insights: payload as Insights, mailRes };
}

export function AdminOverviewStats() {
  const [data, setData] = useState<Insights | null>(null);
  const [mailTotals, setMailTotals] = useState<MailTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // State changes only in the promise callbacks, so the mount effect can start
  // it; `load` adds the synchronous "loading" reset for the Refresh button.
  const fetchStats = useCallback(
    () =>
      requestInsights()
        .then(async ({ insights, mailRes }) => {
          setData(insights);
          // Mail totals are a nice-to-have headline; a failure here shouldn't blank
          // the whole overview, so swallow and leave the CTR card showing "—".
          if (mailRes.ok) {
            const mail = (await mailRes.json()) as { totals?: MailTotals };
            setMailTotals(mail.totals ?? null);
          } else {
            setMailTotals(null);
          }
          setLastUpdatedAt(Date.now());
        })
        .catch((err: Error) => setError(err.message || "Failed to load insights."))
        .finally(() => setLoading(false)),
    [],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const usersByRole = useMemo(() => {
    if (!data) return [] as Array<{ role: UserRole | "none"; count: number }>;
    return ROLE_ORDER.map((role) => ({
      role,
      count: data.workspace.users_by_role[role] ?? 0,
    }));
  }, [data]);

  const reminders = data?.reminders;
  const workspace = data?.workspace;

  const ctrValue = mailTotals && mailTotals.sends_count > 0
    ? fmtPct(mailTotals.real_clicks / mailTotals.sends_count)
    : mailTotals
      ? "0%"
      : loading
        ? "…"
        : "—";

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-4">Workspace KPIs, the latest reminder run, and mail engagement at a glance.</p>
        <div className="flex shrink-0 items-center gap-2">
          <FreshnessPill updatedAt={lastUpdatedAt} loading={loading} />
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            disabled={loading}
            className="rounded-lg border border-glass/15 bg-glass/5 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-glass/10 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <Notice>
          {error}
        </Notice>
      ) : null}

      <div className="relative">
        {lastUpdatedAt != null ? (
          <span key={`sweep-${lastUpdatedAt}`} aria-hidden className="data-refresh-sweep" />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Last reminder run"
            value={
              reminders?.last_cron_run
                ? `${reminders.last_cron_run.sent} sent`
                : loading
                  ? "…"
                  : "never"
            }
            hint={
              reminders?.last_cron_run
                ? `${fmtRelative(reminders.last_cron_run.sent_at)} · ${reminders.last_cron_run.failed} failed${
                    reminders.last_cron_run.skipped_dry_run > 0
                      ? ` · ${reminders.last_cron_run.skipped_dry_run} dry`
                      : ""
                  }`
                : "—"
            }
            info="Latest weekly cron run. Counts how many real reminder emails were sent, failed, or skipped (dry runs)."
          />
          <StatCard
            label="Sent in last 7 days"
            value={String(reminders?.last_7_days.sent ?? 0)}
            hint={reminders ? `${reminders.last_7_days.failed} failed` : loading ? "…" : "—"}
            info="Production reminder emails dispatched in the last 7 days. Excludes dry runs and admin test sends."
          />
          <StatCard
            label="30-day failure rate"
            value={reminders ? fmtPct(reminders.failure_rate_30d) : loading ? "…" : "0%"}
            hint={reminders ? `${reminders.last_30_days.total} sends recorded` : "No data yet"}
            info="Share of reminder sends in the last 30 days that returned an error from Resend."
          />
          <StatCard
            label="Active users (7d)"
            value={workspace ? String(workspace.active_last_7_days) : loading ? "…" : "0"}
            hint={workspace ? `of ${workspace.total_users} total` : undefined}
            info="Auth users whose last sign-in timestamp falls inside the past 7 days."
          />
          <StatCard
            label="Hours logged this month"
            value={workspace ? `${workspace.hours_logged_this_month}h` : loading ? "…" : "0h"}
            hint={workspace ? `${workspace.hours_logged_last_7_days}h in last 7d` : undefined}
            info="Sum of net minutes across every user's time logs since the first of the current month."
          />
          <StatCard
            label="Mail click-through (90d)"
            value={ctrValue}
            hint={
              mailTotals
                ? `${mailTotals.real_clicks} clicks / ${mailTotals.sends_count} sends`
                : loading
                  ? "…"
                  : "no data"
            }
            info="Real (non-scanner) link clicks divided by tracked sends over the last 90 days."
          />
          <div className="rounded-xl border border-glass/10 bg-glass/5 p-3 sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] uppercase tracking-[0.15em] text-ink-4/80">Users by role</p>
              <InfoTooltip label="About roles">
                Counts each role stored in <code>app_metadata.role</code>. Users with no role assigned fall under &quot;Not selected&quot;.
              </InfoTooltip>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {usersByRole.length === 0 ? (
                <span className="text-xs text-ink-4">
                  {loading ? "Loading…" : "No users found."}
                </span>
              ) : (
                usersByRole.map(({ role, count }) => (
                  <span
                    key={role}
                    className="inline-flex items-center gap-1.5 rounded-full border border-glass/10 bg-glass/[0.06] px-3 py-1 text-xs text-ink-2"
                  >
                    <span className="text-ink-3">{userRoleLabel(role === "none" ? null : (role as UserRole))}</span>
                    <span className="tabular-nums text-ink">{count}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] uppercase tracking-[0.15em] text-ink-4/80">
            Most reminded in last 90 days
          </p>
          <InfoTooltip label="About reminders">
            Recipients who received the most production reminder emails in the last 90 days.
          </InfoTooltip>
        </div>
        {reminders && reminders.top_reminded_90d.length > 0 ? (
          <ul className="mt-2 divide-y divide-glass/5">
            {reminders.top_reminded_90d.map((entry) => (
              <li
                key={entry.email}
                className="flex items-center justify-between gap-3 py-1.5 text-sm text-ink-2"
              >
                <span className="truncate">{entry.email}</span>
                <span className="tabular-nums text-ink">
                  {entry.count} reminder{entry.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-4">
            {loading ? "Loading…" : "No reminders sent in the last 90 days. Nice."}
          </p>
        )}
      </div>
    </div>
  );
}
