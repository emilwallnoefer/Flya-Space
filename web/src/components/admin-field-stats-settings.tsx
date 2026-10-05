"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { InfoTooltip } from "@/components/info-tooltip";
import { fmtRelative } from "@/lib/admin-format";

type AdminView = {
  sales_regions: Record<string, string>;
  updated_at: string | null;
  updated_by: string | null;
  source: { is_me: boolean; connected: boolean; google_email: string | null } | null;
  my_connection: { google_email: string | null } | null;
  sales_names: string[];
  sheet_error: string | null;
};

/**
 * Admin → Field stats: which Google connection reads the planning sheet, and
 * which region each salesperson stands for.
 */
export function AdminFieldStatsSettings() {
  const [view, setView] = useState<AdminView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = useCallback((next: AdminView) => {
    setView(next);
    setDraft(next.sales_regions);
  }, []);

  const request = useCallback(
    async (init?: RequestInit) => {
      setPending(true);
      setError(null);
      setSaved(false);
      try {
        const response = await fetch("/api/admin/field-stats-settings", { cache: "no-store", ...init });
        const payload = (await response.json().catch(() => ({}))) as AdminView & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Request failed.");
        apply(payload);
        return true;
      } catch (err) {
        setError((err as Error).message || "Request failed.");
        return false;
      } finally {
        setPending(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    void request();
  }, [request]);

  const patch = useCallback(
    (body: Record<string, unknown>) =>
      request({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    [request],
  );

  // Every name the sheet uses, plus any mapped earlier or added by hand.
  const names = useMemo(() => {
    const all = new Map<string, string>();
    for (const name of [...(view?.sales_names ?? []), ...Object.keys(draft)]) {
      if (!all.has(name.toLowerCase())) all.set(name.toLowerCase(), name);
    }
    return [...all.values()].sort((a, b) => a.localeCompare(b));
  }, [view, draft]);

  const dirty = useMemo(() => {
    const clean = (map: Record<string, string>) =>
      JSON.stringify(
        Object.entries(map)
          .filter(([, region]) => region.trim())
          .map(([name, region]) => [name, region.trim()])
          .sort(),
      );
    return view ? clean(draft) !== clean(view.sales_regions) : false;
  }, [draft, view]);

  const source = view?.source ?? null;

  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm text-ink-4">
        Field stats (on the workspace home) chart the &ldquo;Mission planning&rdquo; sheet for everyone with a role. Numbers
        refresh at most every 10 minutes.
      </p>

      {error ? <Notice>{error}</Notice> : null}

      <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-ink">Sheet connection</p>
              <InfoTooltip label="About the sheet connection">
                The sheet is read with one admin&apos;s Google connection (the one made under Settings → Gmail,
                which includes read-only spreadsheet access). That account must be able to open the sheet.
              </InfoTooltip>
            </div>
            <p className="text-xs text-ink-4">
              {!view
                ? "Loading…"
                : !source
                  ? "Not connected — nobody can see Field stats yet."
                  : !source.connected
                    ? "The chosen admin disconnected Google. Reconnect to restore Field stats."
                    : `Reading as ${source.google_email ?? "an admin's Google account"}${source.is_me ? " (you)" : ""}.`}
            </p>
            {view?.sheet_error && source?.connected ? <p className="text-xs text-warn">{view.sheet_error}</p> : null}
          </div>
          <Button
            size="sm"
            variant={source?.connected ? "glass-quiet" : "accent"}
            disabled={pending || !view || !view.my_connection || (source?.is_me && source.connected)}
            title={view && !view.my_connection ? "Connect Gmail under Settings first." : undefined}
            onClick={() => void patch({ use_my_connection: true })}
          >
            {source?.is_me && source.connected ? "Using your connection" : "Use my Google connection"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <p className="text-sm font-medium text-ink">Salesperson → region</p>
          <InfoTooltip label="About the region map">
            The regions chart groups POCs and trainings by the salesperson in &ldquo;Reporting to&rdquo;. Give each
            salesperson their region; several can share one. A salesperson left blank shows under their own name.
          </InfoTooltip>
        </div>
        {names.length === 0 ? (
          <p className="text-xs text-ink-4">
            {view ? "No salesperson found in the sheet yet — add one below." : "Loading…"}
          </p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {names.map((name) => (
              <li key={name} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2">
                <span className="truncate text-xs text-ink">{name}</span>
                <Input
                  value={draft[name] ?? ""}
                  placeholder="Region"
                  maxLength={80}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [name]: event.target.value }))}
                  className="py-1 text-xs"
                />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={newName}
            placeholder="Add a salesperson"
            maxLength={80}
            onChange={(event) => setNewName(event.target.value)}
            className="w-48 py-1 text-xs"
          />
          <Button
            size="sm"
            variant="glass-quiet"
            disabled={!newName.trim()}
            onClick={() => {
              const name = newName.trim();
              setDraft((prev) => ({ ...prev, [name]: prev[name] ?? "" }));
              setNewName("");
            }}
          >
            Add
          </Button>
          <span className="flex-1" />
          {saved ? <span className="text-xs text-ink-4">Saved.</span> : null}
          {view?.updated_at ? (
            <span className="text-[11px] text-ink-5">
              Last change {fmtRelative(view.updated_at)}
              {view.updated_by ? ` by ${view.updated_by}` : ""}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="accent"
            disabled={pending || !dirty}
            onClick={async () => {
              const regions = Object.fromEntries(
                Object.entries(draft)
                  .map(([name, region]) => [name, region.trim()] as const)
                  .filter(([, region]) => region),
              );
              if (await patch({ sales_regions: regions })) setSaved(true);
            }}
          >
            Save regions
          </Button>
        </div>
      </div>
    </div>
  );
}
