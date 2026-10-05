"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Notice, Select } from "@/components/ui";
import { InfoTooltip } from "@/components/info-tooltip";
import { HoverTooltip, type HoverPos } from "@/components/mail-tracking/stat-tile";
import { fmtRelative } from "@/lib/admin-format";
import type { FieldStats, FieldStatsBucket } from "@/lib/field-stats";

type Loaded = { stats: FieldStats; fetchedAt: string; stale: boolean };

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function monthLabel(month: string, format = MONTH_FORMAT) {
  return format.format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * Field stats: POCs, trainings, travel days and regions, computed server-side
 * from the "Mission planning" sheet (`lib/field-stats.ts`). The server caches
 * one read for 10 minutes, so this fetches on open and on demand only.
 */
export function FieldStatsPanel() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/field-stats", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Partial<Loaded> & { error?: string };
      if (!response.ok || !payload.stats) throw new Error(payload.error || "Could not load the field stats.");
      setData(payload as Loaded);
    } catch (err) {
      setError((err as Error).message || "Could not load the field stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = data?.stats ?? null;
  const bucket: FieldStatsBucket | null = stats ? (month === "all" ? stats.all : stats.byMonth[month] ?? null) : null;
  const periodLabel = month === "all" ? `since ${stats ? monthLabel(stats.months[0] ?? "2026-01") : "January 2026"}` : monthLabel(month);

  return (
    <Card padding="lg" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold text-ink">Field stats</h2>
          <InfoTooltip label="Where these numbers come from">
            Counted from the &ldquo;Mission planning&rdquo; tab of the planning sheet, from 1 January 2026 up to
            today. Multi-day POCs and trainings count once, in the month they start. Unconfirmed entries (TBC,
            pre-booked) and days off are not counted. Regions follow the salesperson in &ldquo;Reporting to&rdquo;.
          </InfoTooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <span className={`text-[11px] ${data.stale ? "text-warn" : "text-ink-4"}`}>
              {data.stale ? "Sheet unreachable — showing data from " : "Updated "}
              {fmtRelative(data.fetchedAt)}
            </span>
          ) : null}
          <Select
            aria-label="Period"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            disabled={!stats}
            className="w-auto py-1.5 text-xs"
          >
            <option value="all">All of {stats?.months[0]?.slice(0, 4) ?? "2026"} →</option>
            {[...(stats?.months ?? [])].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="glass-quiet" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}

      {!stats && loading ? <p className="py-10 text-center text-sm text-ink-4">Reading the planning sheet…</p> : null}

      {bucket && stats ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <BarCard
              title="Regions"
              info="POCs and trainings per region, by the salesperson they report to. Admins map salespeople to regions under Admin → Field stats; an unmapped salesperson shows under their own name."
              period={periodLabel}
              unit="event"
              rows={bucket.regions.map((r) => ({
                key: r.region,
                label: r.region,
                value: r.events,
                detail: `${r.poc} POC${r.poc === 1 ? "" : "s"} · ${r.training} training${r.training === 1 ? "" : "s"}`,
              }))}
              empty="No POCs or trainings in this period."
            />
            <BarCard
              title="Travel days per pilot"
              info="Days spent travelling or away: “travel to …”, “travel time”, “out of the office”, and POC/training days not marked as in the office."
              period={periodLabel}
              unit="day"
              rows={pilotRows(bucket, "travelDays")}
              empty="No travel days in this period."
            />
            <BarCard
              title="POCs per pilot"
              info="Entries naming a POC or demo. A POC spread over several days counts once."
              period={periodLabel}
              unit="POC"
              rows={pilotRows(bucket, "poc")}
              empty="No POCs in this period."
            />
            <BarCard
              title="Trainings per pilot"
              info="Entries naming a training. A training spread over several days counts once."
              period={periodLabel}
              unit="training"
              rows={pilotRows(bucket, "training")}
              empty="No trainings in this period."
            />
          </div>
          {month === "all" && stats.months.length > 1 ? <MonthlyCard stats={stats} onPick={setMonth} /> : null}
        </>
      ) : null}
    </Card>
  );
}

type BarRow = { key: string; label: string; value: number; detail?: string };

function pilotRows(bucket: FieldStatsBucket, field: "poc" | "training" | "travelDays"): BarRow[] {
  return bucket.pilots
    .map((p) => ({ key: p.pilot, label: p.pilot, value: p[field] }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function BarCard({
  title,
  info,
  period,
  unit,
  rows,
  empty,
}: {
  title: string;
  info: string;
  period: string;
  unit: string;
  rows: BarRow[];
  empty: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverPos>(null);
  const max = useMemo(() => rows.reduce((acc, row) => Math.max(acc, row.value), 0), [rows]);
  const total = useMemo(() => rows.reduce((acc, row) => acc + row.value, 0), [rows]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-ink">{title}</h3>
          <InfoTooltip label={`About ${title.toLowerCase()}`}>{info}</InfoTooltip>
        </div>
        <span className="text-[11px] text-ink-4">
          {plural(total, unit)} · {period}
        </span>
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-xs text-ink-4">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const widthPct = max > 0 ? Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100) : 0;
            return (
              <li
                key={row.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                onMouseEnter={(event) => {
                  const parent = containerRef.current;
                  if (!parent) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const parentRect = parent.getBoundingClientRect();
                  setHover({
                    x: rect.left - parentRect.left + rect.width / 2,
                    y: rect.top - parentRect.top,
                    width: parentRect.width,
                    content: (
                      <div className="min-w-[140px]">
                        <div className="font-semibold text-ink">{row.label}</div>
                        <div className="text-ink-2">{plural(row.value, unit)}</div>
                        {row.detail ? <div className="text-ink-4">{row.detail}</div> : null}
                        {total > 0 ? (
                          <div className="text-ink-4">{Math.round((row.value / total) * 100)}% of {period}</div>
                        ) : null}
                      </div>
                    ),
                  });
                }}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink">{row.label}</div>
                  <div className="relative mt-0.5 h-2 overflow-hidden rounded bg-glass/5">
                    <div className="absolute inset-y-0 left-0 rounded bg-accent/80" style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-ink-2">{row.value}</span>
              </li>
            );
          })}
        </ul>
      )}
      <HoverTooltip hover={hover} />
    </div>
  );
}

/** Team totals per month; a column opens that month. */
function MonthlyCard({ stats, onPick }: { stats: FieldStats; onPick: (month: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverPos>(null);
  const months = useMemo(
    () =>
      stats.months.map((m) => {
        const bucket = stats.byMonth[m];
        const sum = (field: "poc" | "training" | "travelDays") =>
          bucket.pilots.reduce((acc, p) => acc + p[field], 0);
        return { month: m, travelDays: sum("travelDays"), poc: sum("poc"), training: sum("training") };
      }),
    [stats],
  );
  const max = Math.max(1, ...months.map((m) => m.travelDays));

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-xs font-semibold text-ink">Team travel days per month</h3>
        <InfoTooltip label="About team travel days per month">
          All pilots&apos; travel days added up per month. Click a month to see its breakdown.
        </InfoTooltip>
      </div>
      <div className="flex h-36 items-end gap-1.5">
        {months.map((m) => (
          <button
            key={m.month}
            type="button"
            onClick={() => onPick(m.month)}
            aria-label={`${monthLabel(m.month)}: ${plural(m.travelDays, "travel day")}`}
            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            onMouseEnter={(event) => {
              const parent = containerRef.current;
              if (!parent) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const parentRect = parent.getBoundingClientRect();
              setHover({
                x: rect.left - parentRect.left + rect.width / 2,
                y: rect.top - parentRect.top + rect.height * (1 - m.travelDays / max),
                width: parentRect.width,
                content: (
                  <div className="min-w-[140px]">
                    <div className="font-semibold text-ink">{monthLabel(m.month)}</div>
                    <div className="text-ink-2">{plural(m.travelDays, "travel day")}</div>
                    <div className="text-ink-4">
                      {plural(m.poc, "POC")} · {plural(m.training, "training")}
                    </div>
                  </div>
                ),
              });
            }}
          >
            <span className="text-[10px] tabular-nums text-ink-4">{m.travelDays || ""}</span>
            <span className="flex min-h-0 w-full flex-1 items-end justify-center">
              <span
                className="w-full max-w-10 rounded-t bg-accent/80 transition group-hover:bg-accent"
                style={{ height: `${(m.travelDays / max) * 100}%`, minHeight: m.travelDays > 0 ? 2 : 0 }}
              />
            </span>
            <span className="text-[10px] text-ink-4">{monthLabel(m.month, MONTH_SHORT)}</span>
          </button>
        ))}
      </div>
      <HoverTooltip hover={hover} />
    </div>
  );
}
