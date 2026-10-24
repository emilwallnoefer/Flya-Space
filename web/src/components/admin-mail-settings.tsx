"use client";

import { Notice } from "@/components/ui";
import { useCallback, useEffect, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { DEFAULT_MAIL_BRIEF_MODEL, MAIL_BRIEF_MODELS } from "@/lib/mail-brief-model";

async function requestMailBriefModel(): Promise<string | null> {
  const response = await fetch("/api/admin/workspace-settings", { cache: "no-store" });
  const payload = (await response.json()) as
    | { settings: { mail_brief_model: string | null } }
    | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load settings.");
  return (payload as { settings: { mail_brief_model: string | null } }).settings.mail_brief_model;
}

export function AdminMailSettings() {
  const [model, setModel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State changes only in the promise callbacks, so the mount effect can start
  // it; `error` already starts out null.
  const load = useCallback(
    () =>
      requestMailBriefModel().then(
        (next) => {
          setModel(next);
          setLoaded(true);
        },
        (err: Error) => setError(err.message || "Failed to load settings."),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const setBriefModel = useCallback(async (next: string) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/workspace-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mail_brief_model: next }),
      });
      const payload = (await response.json()) as
        | { settings: { mail_brief_model: string | null } }
        | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to update.");
      setModel((payload as { settings: { mail_brief_model: string | null } }).settings.mail_brief_model);
    } catch (err) {
      setError((err as Error).message || "Failed to update.");
    } finally {
      setPending(false);
    }
  }, []);

  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm text-ink-4">
        Workspace-wide settings for the mail composer. Applies to everyone, immediately.
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
              <p className="text-sm font-medium text-ink">Mail brief model</p>
              <InfoTooltip label="About the mail brief model">
                Which Claude model writes emails in the composer&apos;s AI Brief mode. Opus 4.8 gives the
                best prose; Sonnet 5 is faster and cheaper. Applies workspace-wide, immediately.
              </InfoTooltip>
            </div>
            <p className="text-xs text-ink-4">Used only by AI Brief mode; Guided mode is unaffected.</p>
          </div>
          <select
            value={model ?? DEFAULT_MAIL_BRIEF_MODEL}
            onChange={(event) => {
              void setBriefModel(event.target.value);
            }}
            disabled={pending || !loaded}
            className="shrink-0 rounded-lg border border-glass/15 bg-panel/70 px-3 py-1.5 text-xs text-ink transition disabled:opacity-60"
          >
            {MAIL_BRIEF_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
