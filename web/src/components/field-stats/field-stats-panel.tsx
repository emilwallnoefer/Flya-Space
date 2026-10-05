"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Notice, Select } from "@/components/ui";
import { InfoTooltip } from "@/components/info-tooltip";
import { HoverTooltip, type HoverPos } from "@/components/mail-tracking/stat-tile";
import { fmtRelative } from "@/lib/admin-format";
import type { FieldEvent, FieldStats, FieldStatsBucket, FieldTravelDay } from "@/lib/field-stats";

type Loaded = { stats: FieldStats; fetchedAt: string; stale: boolean };

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function monthLabel(month: string, format = MONTH_FORMAT) {
  return format.format(new Date(`${month}-01T00:00:00Z`));
}

function dayLabel(date: string) {
  return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

function spanLabel(start: string, end: string) {
  return start === end ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`;
}

const KIND_LABEL = { poc: "POC", training: "Training" } as const;

function eventItem(event: FieldEvent, context: string): DetailItem {
  return {
    key: `${event.pilot}-${event.start}-${event.kind}`,
    title: event.title,
    meta: `${spanLabel(event.start, event.end)}${event.days > 1 ? ` · ${event.days} days` : ""} · ${context}`,
  };
}

function travelItem(day: FieldTravelDay): DetailItem {
  return {
    key: `${day.pilot}-${day.date}`,
    title: day.activity || day.status,
    meta: `${dayLabel(day.date)}${day.activity && day.status ? ` · ${day.status}` : ""}`,
  };
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
  const inPeriod = (date: string) => month === "all" || date.startsWith(month);
  const events = stats ? stats.events.filter((e) => inPeriod(e.start)) : [];
  const travel = stats ? stats.travel.filter((d) => inPeriod(d.date)) : [];
  const periodLabel = month === "all" ? `since ${stats ? monthLabel(stats.months[0] ?? "2026-01") : "January 2026"}` : monthLabel(month);

  return (
    <Card padding="lg" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold text-ink">Field stats</h2>
          <InfoTooltip label="Where these numbers come from">
            Counted from the &ldquo;Mission planning&rdquo; tab of the planning sheet, from 1 January 2026 up to
            yesterday — today and anything planned later are not counted. Back-to-back days for the same customer count as one POC or training, in the month it starts. Unconfirmed entries (TBC,
            pre-booked) and days off are not counted. Regions follow the salesperson in &ldquo;Reporting to&rdquo;.
            Click a name in a chart to see exactly what it counts.
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
                items: events
                  .filter((e) => e.region === r.region)
                  .map((e) => eventItem(e, `${e.pilot} · ${KIND_LABEL[e.kind]}`)),
              }))}
              empty="No POCs or trainings in this period."
            />
            <BarCard
              title="Travel days per pilot"
              info="Days spent travelling or away: “travel to …”, “travel time”, “out of the office”, and POC/training days not marked as in the office."
              period={periodLabel}
              unit="day"
              rows={pilotRows(bucket, "travelDays", (pilot) =>
                travel.filter((d) => d.pilot === pilot).map(travelItem),
              )}
              empty="No travel days in this period."
            />
            <BarCard
              title="POCs per pilot"
              info="Entries naming a POC or demo. Back-to-back days for the same customer count as one POC."
              period={periodLabel}
              unit="POC"
              rows={pilotRows(bucket, "poc", (pilot) =>
                events.filter((e) => e.pilot === pilot && e.kind === "poc").map((e) => eventItem(e, e.region)),
              )}
              empty="No POCs in this period."
            />
            <BarCard
              title="Trainings per pilot"
              info="Entries naming a training. Back-to-back days for the same customer count as one training, even when the course changes (Intro, then AIIM)."
              period={periodLabel}
              unit="training"
              rows={pilotRows(bucket, "training", (pilot) =>
                events.filter((e) => e.pilot === pilot && e.kind === "training").map((e) => eventItem(e, e.region)),
              )}
              empty="No trainings in this period."
            />
          </div>
          {month === "all" && stats.months.length > 1 ? <MonthlyCard stats={stats} onPick={setMonth} /> : null}
        </>
      ) : null}
    </Card>
  );
}

type DetailItem = { key: string; title: string; meta: string };

type BarRow = {
  key: string;
  label: string;
  value: number;
  detail?: string;
  /** What this bar counts; listed when the row is clicked. */
  items: DetailItem[];
};

function pilotRows(
  bucket: FieldStatsBucket,
  field: "poc" | "training" | "travelDays",
  itemsFor: (pilot: string) => DetailItem[],
): BarRow[] {
  return bucket.pilots
    .map((p) => ({ key: p.pilot, label: p.pilot, value: p[field], items: p[field] > 0 ? itemsFor(p.pilot) : [] }))
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find((row) => row.key === selectedKey && row.value > 0) ?? null;
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
              <li key={row.key}>
                <button
                  type="button"
                  disabled={row.value === 0}
                  aria-expanded={selected?.key === row.key}
                  onClick={() => setSelectedKey((current) => (current === row.key ? null : row.key))}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-0.5 text-left transition enabled:hover:bg-glass/8 ${
                    selected?.key === row.key ? "bg-glass/10" : ""
                  }`}
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
                  <span className="block min-w-0">
                    <span className="block truncate text-xs text-ink">{row.label}</span>
                    <span className="relative mt-0.5 block h-2 overflow-hidden rounded bg-glass/5">
                      <span
                        className="absolute inset-y-0 left-0 rounded bg-accent/80"
                        style={{ width: `${widthPct}%` }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-2">{row.value}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected ? (
        <div className="mt-3 border-t border-glass/10 pt-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink">
              {selected.label} · {plural(selected.value, unit)}
            </p>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              className="text-[11px] text-ink-4 transition hover:text-ink"
            >
              Close
            </button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {selected.items.map((item) => (
              <li key={item.key} className="rounded-md bg-glass/5 px-2 py-1">
                <div className="truncate text-xs text-ink" title={item.title}>
                  {item.title}
                </div>
                <div className="text-[11px] text-ink-4">{item.meta}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
