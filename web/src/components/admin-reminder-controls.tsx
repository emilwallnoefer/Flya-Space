"use client";

import { Notice } from "@/components/ui";
import { useCallback, useEffect, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { fmtAbsolute, fmtRelative } from "@/lib/admin-format";

// Mirror of the fields we read from `workspace_settings`. Declared inline (not
// imported from the "server-only" lib) so this client component never pulls in
// server code.
type WorkspaceSettings = {
  reminder_paused: boolean;
  reminder_paused_at: string | null;
  reminder_paused_by: string | null;
  mail_brief_model: string | null;
  updated_at: string;
};

async function requestWorkspaceSettings(): Promise<WorkspaceSettings> {
  const response = await fetch("/api/admin/workspace-settings", { cache: "no-store" });
  const payload = (await response.json()) as { settings: WorkspaceSettings } | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load settings.");
  return (payload as { settings: WorkspaceSettings }).settings;
}

export function AdminReminderControls() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pausePending, setPausePending] = useState(false);
  const [actionPending, setActionPending] = useState<null | "dry" | "test">(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");

  // State changes only in the promise callbacks, so the mount effect can start
  // it; `error` already starts out null.
  const load = useCallback(
    () =>
      requestWorkspaceSettings().then(setSettings, (err: Error) =>
        setError(err.message || "Failed to load settings."),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const togglePause = useCallback(async (next: boolean) => {
    setPausePending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/workspace-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminder_paused: next }),
      });
      const payload = (await response.json()) as { settings: WorkspaceSettings } | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to update.");
      setSettings((payload as { settings: WorkspaceSettings }).settings);
    } catch (err) {
      setError((err as Error).message || "Failed to update.");
    } finally {
      setPausePending(false);
    }
  }, []);

  const runDryRun = useCallback(async () => {
    setActionPending("dry");
    setActionResult(null);
    setError(null);
    try {
      const response = await fetch("/api/cron/time-log-reminder?dry=1&force=1", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | { ok: boolean; considered?: number; reminded?: number; skipped?: boolean; reason?: string }
        | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Dry run failed.");
      const summary = payload as {
        considered?: number;
        reminded?: number;
        skipped?: boolean;
        reason?: string;
      };
      if (summary.skipped) {
        setActionResult(`Skipped (${summary.reason ?? "unknown reason"}).`);
      } else {
        setActionResult(
          `Dry run OK: considered ${summary.considered ?? 0} user${
            summary.considered === 1 ? "" : "s"
          }, would remind ${summary.reminded ?? 0}.`,
        );
      }
    } catch (err) {
      setError((err as Error).message || "Dry run failed.");
    } finally {
      setActionPending(null);
    }
  }, []);

  const sendTest = useCallback(async () => {
    const target = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError("Enter a valid email address for the test send.");
      return;
    }
    setActionPending("test");
    setActionResult(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/cron/time-log-reminder?send_test=${encodeURIComponent(target)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | { ok: boolean; to?: string; message_id?: string; error?: string }
        | { error: string };
      if (!response.ok || !("ok" in payload) || !payload.ok) {
        throw new Error(("error" in payload && payload.error) || "Test send failed.");
      }
      setActionResult(`Test sent to ${payload.to ?? target} (message ${payload.message_id ?? "?"}).`);
    } catch (err) {
      setError((err as Error).message || "Test send failed.");
    } finally {
      setActionPending(null);
    }
  }, [testEmail]);

  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm text-ink-4">
        Pause or test the weekly Monday reminder cron (Mon 09:00 Europe/Zurich) without leaving the admin panel.
      </p>

      {error ? (
        <Notice>
          {error}
        </Notice>
      ) : null}

      <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-ink">Monday reminder</p>
              <InfoTooltip label="About the Monday reminder">
                Weekly cron at Mon 09:00 Europe/Zurich. When paused, real and forced runs skip
                sending; dry runs still preview the candidate list.
              </InfoTooltip>
            </div>
            {settings?.reminder_paused ? (
              <p
                className="text-xs text-warn/90"
                title={`Paused by ${settings.reminder_paused_by || "unknown"} (${fmtAbsolute(settings.reminder_paused_at)})`}
              >
                Paused {fmtRelative(settings.reminder_paused_at)}
              </p>
            ) : settings ? (
              <p className="text-xs text-positive/85">Active · next Mon 09:00 CET</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!settings) return;
              void togglePause(!settings.reminder_paused);
            }}
            disabled={pausePending || !settings}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
              settings?.reminder_paused
                ? "border-emerald-300/55 bg-emerald-400/15 text-positive hover:bg-emerald-400/25"
                : "border-amber-300/55 bg-amber-400/15 text-warn hover:bg-amber-400/25"
            }`}
          >
            {pausePending ? "Saving…" : settings?.reminder_paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-glass/10 bg-glass/5 p-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="text-sm font-medium text-ink">Dry run</p>
            <InfoTooltip label="About dry runs">
              Runs the candidate scan right now without sending any real emails. Rows are recorded
              in the audit log as <code>skipped_dry_run</code>.
            </InfoTooltip>
          </div>
          <button
            type="button"
            onClick={() => {
              void runDryRun();
            }}
            disabled={actionPending === "dry"}
            className="shrink-0 rounded-lg border border-glass/15 bg-glass/5 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-glass/10 disabled:opacity-60"
          >
            {actionPending === "dry" ? "Running…" : "Run"}
          </button>
        </div>

        <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-ink">Test send</p>
            <InfoTooltip label="About test sends">
              Sends one real email via Resend (subject prefixed with <code>[TEST]</code>) to the
              address you enter. Does not touch the candidate list or audit log.
            </InfoTooltip>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              placeholder="you@flyability.com"
              className="min-w-[180px] flex-1 rounded-lg border border-glass/15 bg-panel/80 px-2 py-1.5 text-xs text-ink placeholder:text-ink-5"
            />
            <button
              type="button"
              onClick={() => {
                void sendTest();
              }}
              disabled={actionPending === "test" || testEmail.trim().length === 0}
              className="rounded-lg border border-glass/15 bg-glass/5 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-glass/10 disabled:opacity-60"
            >
              {actionPending === "test" ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>

      {actionResult ? (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-positive">
          {actionResult}
        </p>
      ) : null}
    </div>
  );
}
