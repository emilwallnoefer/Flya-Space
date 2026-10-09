"use client";

import { useMemo, useState } from "react";
import type { FieldEvent, FieldStats, FieldStatsBucket, FieldTravelDay } from "@/lib/field-stats";
import { cn } from "@/lib/cn";
import { ChevronIcon, MobileEmpty, MobileGroup, MobileSegmented, MobileTopBar } from "../primitives";
import type { useFieldStats } from "./use-field-stats";

type Loaded = ReturnType<typeof useFieldStats>;

const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const monthLabel = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`));
const dayLabel = (d: string) => DAY.format(new Date(`${d}T00:00:00Z`));

type Row = { key: string; label: string; value: number; detail?: string; items: Array<{ key: string; title: string; meta: string }> };

/**
 * "Team in the field" on the phone: the four charts as plain bar lists
 * (value inline, no hover tooltips), a period picker, and the entries behind
 * a bar one tap away — for the roles the server gives them to (pilots and
 * admins get entries; sales and HR get counts only, and see no detail).
 */
export function MobileTeamScreen({ field, onBack }: { field: Loaded; onBack: () => void }) {
  const { stats, data, error, loading, reload } = field;
  const [month, setMonth] = useState<string>("all");
  const [chart, setChart] = useState<"regions" | "travel" | "poc" | "training">("regions");
  const [open, setOpen] = useState<string | null>(null);

  const bucket: FieldStatsBucket | null = stats ? (month === "all" ? stats.all : (stats.byMonth[month] ?? null)) : null;
  const rows = useMemo(() => (stats && bucket ? rowsFor(chart, bucket, stats, month) : []), [stats, bucket, chart, month]);
  const max = rows.reduce((acc, r) => Math.max(acc, r.value), 0);
  const unit = chart === "regions" ? "events" : chart === "travel" ? "days" : chart === "poc" ? "POCs" : "trainings";

  return (
    <>
      <MobileTopBar title="Team in the field" onBack={onBack} right={<button type="button" onClick={() => void reload()} disabled={loading} className="min-h-9 px-2 text-xs font-medium text-accent-soft disabled:opacity-50">{loading ? "…" : "Refresh"}</button>} />
      <div className="space-y-4 px-4 pt-1">
        <p className="text-xs text-ink-4">
          Counted from the Mission planning sheet since January, up to yesterday.
          {data ? (data.stale ? " Sheet unreachable — showing the last read." : "") : null}
        </p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {stats ? (
          <select value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null); }} aria-label="Period" className="min-h-11 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink">
            <option value="all">All of {stats.months[0]?.slice(0, 4) ?? "2026"}</option>
            {[...stats.months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        ) : null}
        <MobileSegmented
          label="Chart"
          value={chart}
          onChange={(c) => { setChart(c); setOpen(null); }}
          options={[
            { value: "regions", label: "Regions" },
            { value: "travel", label: "Travel" },
            { value: "poc", label: "POCs" },
            { value: "training", label: "Trainings" },
          ]}
        />
        <MobileGroup title={`${unit} · ${month === "all" ? "year to date" : monthLabel(month)}`}>
          {!stats && loading ? <MobileEmpty>Reading the planning sheet…</MobileEmpty> : null}
          {stats && rows.length === 0 ? <MobileEmpty>Nothing in this period.</MobileEmpty> : null}
          {rows.map((row) => {
            const expandable = row.items.length > 0;
            const isOpen = open === row.key;
            return (
              <div key={row.key}>
                <button type="button" disabled={!expandable} onClick={() => setOpen(isOpen ? null : row.key)} className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left enabled:active:bg-glass/8" aria-expanded={expandable ? isOpen : undefined}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] text-ink">{row.label}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{row.value}</span>
                    </span>
                    {row.detail ? <span className="block text-xs text-ink-4">{row.detail}</span> : null}
                    <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-glass/10" aria-hidden>
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }} />
                    </span>
                  </span>
                  {expandable ? <ChevronIcon className={cn("h-4 w-4 shrink-0 text-ink-5 transition", isOpen && "rotate-90")} /> : null}
                </button>
                {isOpen ? (
                  <ul className="space-y-1.5 bg-glass/[0.04] px-4 py-2 text-xs">
                    {row.items.map((item) => (
                      <li key={item.key}>
                        <span className="block text-ink-2">{item.title}</span>
                        <span className="block text-ink-5">{item.meta}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </MobileGroup>
      </div>
    </>
  );
}

function rowsFor(chart: "regions" | "travel" | "poc" | "training", bucket: FieldStatsBucket, stats: FieldStats, month: string): Row[] {
  const inPeriod = (date: string) => month === "all" || date.startsWith(month);
  const events = stats.events.filter((e) => inPeriod(e.start));
  const travel = stats.travel.filter((d) => inPeriod(d.date));
  const eventItem = (e: FieldEvent, context: string) => ({
    key: `${e.pilot}-${e.start}-${e.kind}`,
    title: e.title,
    meta: `${e.start === e.end ? dayLabel(e.start) : `${dayLabel(e.start)} – ${dayLabel(e.end)}`}${e.days > 1 ? ` · ${e.days} days` : ""} · ${context}`,
  });
  const travelItem = (d: FieldTravelDay) => ({ key: `${d.pilot}-${d.date}`, title: d.activity || d.status, meta: `${dayLabel(d.date)}${d.activity && d.status ? ` · ${d.status}` : ""}` });
  if (chart === "regions") {
    return bucket.regions.map((r) => ({
      key: r.region,
      label: r.region,
      value: r.events,
      detail: `${r.poc} POC${r.poc === 1 ? "" : "s"} · ${r.training} training${r.training === 1 ? "" : "s"}`,
      items: events.filter((e) => e.region === r.region).map((e) => eventItem(e, `${e.pilot} · ${e.kind === "poc" ? "POC" : "Training"}`)),
    })).sort((a, b) => b.value - a.value);
  }
  const field = chart === "travel" ? "travelDays" : chart;
  return bucket.pilots
    .map((p) => ({
      key: p.pilot,
      label: p.pilot,
      value: p[field],
      items:
        p[field] > 0
          ? chart === "travel"
            ? travel.filter((d) => d.pilot === p.pilot).map(travelItem)
            : events.filter((e) => e.pilot === p.pilot && e.kind === chart).map((e) => eventItem(e, e.region))
          : [],
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
