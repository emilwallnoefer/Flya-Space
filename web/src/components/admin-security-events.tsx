"use client";

import { Notice } from "@/components/ui";
import { useCallback, useEffect, useState } from "react";
import { FreshnessPill } from "@/components/freshness-pill";
import { fmtRelative } from "@/lib/admin-format";

type SecurityEvent = {
  id: number;
  kind: string;
  severity: string;
  actor_email: string | null;
  ip: string | null;
  user_agent: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

type AlertConfig = {
  enabled: boolean;
  threshold: number;
  last_sent_at: string | null;
};

type FeedResponse = {
  entries: SecurityEvent[];
  alerts: AlertConfig;
};

const KIND_LABELS: Record<string, string> = {
  failed_admin_access: "Blocked admin access",
  rate_limit_tripped: "Rate limit tripped",
  oauth_failure: "OAuth failure",
  suspicious_login: "Suspicious login",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-glass/10 text-ink-3",
  warning: "bg-amber-400/15 text-warn",
  critical: "bg-rose-500/20 text-danger",
};

function describeDetail(entry: SecurityEvent): string {
  const detail = entry.detail;
  if (!detail) return "—";
  if (typeof detail.route === "string") return detail.route;
  const keys = Object.keys(detail);
  if (keys.length === 0) return "—";
  return keys.map((k) => `${k}: ${String(detail[k])}`).join(", ");
}

async function requestSecurityEvents(): Promise<FeedResponse> {
  const response = await fetch("/api/admin/security-events", { cache: "no-store" });
  const payload = (await response.json()) as FeedResponse | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load security events.");
  return payload as FeedResponse;
}

export function AdminSecurityEvents() {
  const [entries, setEntries] = useState<SecurityEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [savingAlerts, setSavingAlerts] = useState(false);

  // State changes only in the promise callbacks, so the mount effect can start
  // it; `load` adds the synchronous "loading" reset for later reloads.
  const fetchEvents = useCallback(
    () =>
      requestSecurityEvents()
        .then(
          (feed) => {
            setEntries(feed.entries);
            setAlerts(feed.alerts);
            setUpdatedAt(Date.now());
          },
          (err: Error) => setError(err.message || "Failed to load security events."),
        )
        .finally(() => setLoading(false)),
    [],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const patchAlerts = useCallback(
    async (patch: { security_alerts_enabled?: boolean; security_alert_threshold?: number }) => {
      setSavingAlerts(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/workspace-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await response.json()) as
          | { settings: { security_alerts_enabled: boolean; security_alert_threshold: number } }
          | { error: string };
        if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to save alert settings.");
        const s = (payload as { settings: { security_alerts_enabled: boolean; security_alert_threshold: number } }).settings;
        setAlerts((prev) => ({
          enabled: s.security_alerts_enabled,
          threshold: s.security_alert_threshold,
          last_sent_at: prev?.last_sent_at ?? null,
        }));
      } catch (err) {
        setError((err as Error).message || "Failed to save alert settings.");
      } finally {
        setSavingAlerts(false);
      }
    },
    [],
  );

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-4">
          Security events: blocked admin-route attempts, OAuth failures, and rate-limit trips. Admins are emailed when
          activity crosses the alert threshold.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <FreshnessPill updatedAt={updatedAt} loading={loading} />
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

      {alerts ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-glass/10 bg-glass/5 px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={alerts.enabled}
              disabled={savingAlerts}
              onChange={(event) => void patchAlerts({ security_alerts_enabled: event.target.checked })}
              className="h-4 w-4 accent-amber-400"
            />
            Breach-alert emails to admins
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-4">
            Threshold
            <input
              type="number"
              min={1}
              max={100}
              value={alerts.threshold}
              disabled={savingAlerts || !alerts.enabled}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(next) && next >= 1 && next <= 100) {
                  void patchAlerts({ security_alert_threshold: next });
                }
              }}
              className="w-16 rounded-lg border border-glass/20 bg-panel/80 px-2 py-1 text-xs text-ink"
            />
            <span className="text-xs text-ink-5">blocked attempts / 15 min from one actor</span>
          </label>
          {savingAlerts ? <span className="text-[11px] text-ink-4">Saving…</span> : null}
        </div>
      ) : null}

      {error ? <Notice>{error}</Notice> : null}

      <div className="relative">
        {updatedAt != null ? (
          <span key={`sweep-${updatedAt}`} aria-hidden className="data-refresh-sweep" />
        ) : null}
        <div className="overflow-x-auto rounded-xl border border-glass/10 bg-glass/5">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-glass/5 text-xs uppercase tracking-wider text-ink-3/80">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-3/80">
                    Loading security events…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-3/80">
                    No security events recorded yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-glass/5 align-middle">
                    <td
                      className="px-3 py-2 text-xs text-ink-4"
                      title={new Date(entry.created_at).toLocaleString()}
                    >
                      {fmtRelative(entry.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink">{KIND_LABELS[entry.kind] ?? entry.kind}</td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                          SEVERITY_STYLES[entry.severity] ?? "bg-glass/10 text-ink-3"
                        }`}
                      >
                        {entry.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{entry.actor_email || "—"}</td>
                    <td className="px-3 py-2 text-xs text-ink-3">{entry.ip || "—"}</td>
                    <td className="px-3 py-2 text-xs text-ink-4">{describeDetail(entry)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
