"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, Notice } from "@/components/ui";
import { InfoTooltip } from "@/components/info-tooltip";
import { HoverTooltip, type HoverPos } from "@/components/mail-tracking/stat-tile";
import { fmtRelative } from "@/lib/admin-format";
import type { FieldEvent, FieldStats, FieldStatsBucket, FieldTravelDay } from "@/lib/field-stats";
import { runningBalance, teamShare } from "@/lib/field-stats-share";

type Loaded = { stats: FieldStats; fetchedAt: string; stale: boolean };

type Measure = "count" | "percent";
const MEASURES: { value: Measure; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "percent", label: "% of workdays" },
];

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
  const [measure, setMeasure] = useState<Measure>("count");

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
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">Field stats</h2>
            <InfoTooltip label="Where these numbers come from">
              Counted from the &ldquo;Mission planning&rdquo; tab of the planning sheet, from 1 January 2026 up to
              yesterday — today and anything planned later are not counted. Back-to-back days for the same customer count as one POC or training, in the month it starts. Unconfirmed entries (TBC,
              pre-booked) and days off are not counted. Regions follow the salesperson in &ldquo;Reporting to&rdquo;.
              &ldquo;% of workdays&rdquo; divides each pilot&apos;s days by their workdays: Monday to Friday, minus the days
              their cell is red (off, bank holiday, compensation), counted from their first day for anyone who joined
              later (Tiago: 4 May). Pilots with nothing in a chart are left out of it.
              {stats && stats.events.length + stats.travel.length > 0
                ? " Click a name in a chart to see exactly what it counts."
                : null}
            </InfoTooltip>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            {data ? (
              <>
                <span className={data.stale ? "text-warn" : "text-ink-4"}>
                  {data.stale ? "Sheet unreachable — showing data from " : "Updated "}
                  {fmtRelative(data.fetchedAt)}
                </span>
                <span className="text-ink-5" aria-hidden>
                  ·
                </span>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="font-medium text-ink-3 underline-offset-2 transition hover:text-ink hover:underline disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {/* Both controls share one height and one chrome, so they read as a single toolbar. */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Show"
            className="inline-flex h-9 items-stretch rounded-lg border border-glass/15 bg-glass/5 p-0.5 text-xs"
          >
            {MEASURES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMeasure(option.value)}
                disabled={!stats}
                aria-pressed={measure === option.value}
                className={`rounded-md px-3 font-medium transition disabled:opacity-50 ${
                  measure === option.value ? "bg-glass/15 text-ink shadow-sm" : "text-ink-3 enabled:hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Period"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            disabled={!stats}
            className="h-9 rounded-lg border border-glass/15 bg-glass/5 px-3 text-xs font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent/50 disabled:opacity-50"
          >
            <option value="all">All of {stats?.months[0]?.slice(0, 4) ?? "2026"}</option>
            {[...(stats?.months ?? [])].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
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
            {measure === "count" ? (
              <>
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
              </>
            ) : (
              <>
                <BarCard
                  title="Travelling, % of workdays"
                  info="Workdays spent travelling or away, out of each pilot's workdays: Monday to Friday, minus red (off) days, from their first day. Weekend travel is left out."
                  period={periodLabel}
                  unit="day"
                  percent
                  rows={shareRows(bucket, "travelDays", (pilot) =>
                    travel.filter((d) => d.pilot === pilot).map(travelItem),
                  )}
                  empty="No travel days in this period."
                />
                <BarCard
                  title="On POCs, % of workdays"
                  info="Workdays spent on a POC or demo, out of each pilot's workdays: Monday to Friday, minus red (off) days, from their first day. Every day of a multi-day POC counts here."
                  period={periodLabel}
                  unit="day"
                  percent
                  rows={shareRows(bucket, "pocDays", (pilot) =>
                    events.filter((e) => e.pilot === pilot && e.kind === "poc").map((e) => eventItem(e, e.region)),
                  )}
                  empty="No POC days in this period."
                />
                <BarCard
                  title="Training, % of workdays"
                  info="Workdays spent training customers, out of each pilot's workdays: Monday to Friday, minus red (off) days, from their first day. Every day of a multi-day training counts here."
                  period={periodLabel}
                  unit="day"
                  percent
                  rows={shareRows(bucket, "trainingDays", (pilot) =>
                    events.filter((e) => e.pilot === pilot && e.kind === "training").map((e) => eventItem(e, e.region)),
                  )}
                  empty="No training days in this period."
                />
              </>
            )}
          </div>
          {month === "all" && stats.months.length > 1 ? <TrendCard stats={stats} onPick={setMonth} percent={measure === "percent"} /> : null}
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

/** Pilots with at least one entry for this chart; nobody shows at zero. */
function pilotRows(
  bucket: FieldStatsBucket,
  field: "poc" | "training" | "travelDays",
  itemsFor: (pilot: string) => DetailItem[],
): BarRow[] {
  return bucket.pilots
    .filter((p) => p[field] > 0)
    .map((p) => ({ key: p.pilot, label: p.pilot, value: p[field], items: itemsFor(p.pilot) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Each pilot's days as a share of their workdays; pilots at 0% (or with no workdays in the period) are left out. */
function shareRows(
  bucket: FieldStatsBucket,
  field: "pocDays" | "trainingDays" | "travelDays",
  itemsFor: (pilot: string) => DetailItem[],
): BarRow[] {
  return bucket.workdays
    .filter((w) => w.workDays > 0)
    .map((w) => ({
      key: w.pilot,
      label: w.pilot,
      value: Math.round((w[field] / w.workDays) * 100),
      detail: `${plural(w[field], "day")} of ${plural(w.workDays, "workday")}`,
      items: w[field] > 0 ? itemsFor(w.pilot) : [],
    }))
    .filter((row) => row.value > 0)
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
  percent = false,
}: {
  title: string;
  info: string;
  period: string;
  unit: string;
  rows: BarRow[];
  empty: string;
  /** Values are shares out of 100, shown with "%". Bars still run to the largest, so the leader fills the row. */
  percent?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverPos>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // No items means nothing to list: an empty bar, or a role that gets counts only.
  const selected = rows.find((row) => row.key === selectedKey && row.items.length > 0) ?? null;
  const max = useMemo(() => rows.reduce((acc, row) => Math.max(acc, row.value), 0), [rows]);
  const total = useMemo(() => rows.reduce((acc, row) => acc + row.value, 0), [rows]);
  const show = (value: number) => (percent ? `${value}% of workdays` : plural(value, unit));

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-ink">{title}</h3>
          <InfoTooltip label={`About ${title.toLowerCase()}`}>{info}</InfoTooltip>
        </div>
        <span className="text-[11px] text-ink-4">
          {percent ? period : `${plural(total, unit)} · ${period}`}
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
                  disabled={row.items.length === 0}
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
                          <div className="text-ink-2">{show(row.value)}</div>
                          {row.detail ? <div className="text-ink-4">{row.detail}</div> : null}
                          {total > 0 && !percent ? (
                            <div className="text-ink-4">
                              {Math.round((row.value / total) * 100)}% of all {unit}s{" "}
                              {period.startsWith("since") ? period : `in ${period}`}
                            </div>
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
                  <span className="shrink-0 text-xs tabular-nums text-ink-2">{percent ? `${row.value}%` : row.value}</span>
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
              {selected.label} · {show(selected.value)}
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

type Trend = "month" | "day";
const TRENDS: { value: Trend; label: string }[] = [
  { value: "month", label: "Per month" },
  { value: "day", label: "Day by day" },
];

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type TrendPoint = {
  key: string;
  value: number;
  /** Shown under each point per month; day points get month ticks instead. */
  label: string;
  /** The month a click opens. */
  month: string;
  tooltip: ReactNode;
};

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Team travel over time, as a line. "Per month" follows the Count / % toggle;
 * "Day by day" is a running balance: every pilot on the road that workday adds
 * one, every pilot at home takes one away, so the line climbs through busy
 * stretches and sinks through quiet ones. Clicking opens that month.
 */
function TrendCard({
  stats,
  onPick,
  percent,
}: {
  stats: FieldStats;
  onPick: (month: string) => void;
  percent: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverPos>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [trend, setTrend] = useState<Trend>("month");

  const points = useMemo<TrendPoint[]>(() => {
    if (trend === "day") {
      return runningBalance(stats.days).map((d) => ({
        key: d.date,
        value: d.balance,
        label: "",
        month: d.date.slice(0, 7),
        tooltip: (
          <div className="min-w-[150px]">
            <div className="font-semibold text-ink">{WEEKDAY_FORMAT.format(new Date(`${d.date}T00:00:00Z`))}</div>
            <div className="text-ink-2">Balance {signed(d.balance)}</div>
            <div className="text-ink-4">
              {d.travel} on the road · {d.home} at home
            </div>
          </div>
        ),
      }));
    }
    return stats.months.map((m) => {
      const bucket = stats.byMonth[m];
      const sum = (field: "poc" | "training" | "travelDays") => bucket.pilots.reduce((acc, p) => acc + p[field], 0);
      const share = teamShare(bucket.workdays, "travelDays");
      return {
        key: m,
        value: percent ? share.percent : sum("travelDays"),
        label: monthLabel(m, MONTH_SHORT),
        month: m,
        tooltip: (
          <div className="min-w-[140px]">
            <div className="font-semibold text-ink">{monthLabel(m)}</div>
            {percent ? (
              <>
                <div className="text-ink-2">{share.percent}% of workdays travelling</div>
                <div className="text-ink-4">
                  {plural(share.days, "day")} of {plural(share.workDays, "workday")}
                </div>
              </>
            ) : (
              <div className="text-ink-2">{plural(sum("travelDays"), "travel day")}</div>
            )}
            <div className="text-ink-4">
              {plural(sum("poc"), "POC")} · {plural(sum("training"), "training")}
            </div>
          </div>
        ),
      };
    });
  }, [stats, percent, trend]);

  // Per month the line starts at zero and its highest month touches the top; the
  // balance can go below zero, so its range always takes zero in.
  const values = points.map((p) => p.value);
  const top = Math.max(trend === "day" ? 0 : 1, ...values);
  const bottom = trend === "day" ? Math.min(0, ...values) : 0;
  const range = top - bottom || 1;
  const xAt = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * 100 : 50);
  const yAt = (value: number) => ((top - value) / range) * 100;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.value)}`).join(" ");
  const zero = yAt(0);
  const area = points.length ? `${path} L${xAt(points.length - 1)},${zero} L${xAt(0)},${zero} Z` : "";
  const monthStarts =
    trend === "day"
      ? points.flatMap((p, i) => (i === 0 || points[i - 1].month !== p.month ? [{ index: i, month: p.month }] : []))
      : [];

  const title =
    trend === "day"
      ? "Team travel balance, day by day"
      : percent
        ? "Team travel, % of workdays per month"
        : "Team travel days per month";

  function indexAt(clientX: number): number | null {
    const plot = plotRef.current;
    if (!plot || points.length === 0) return null;
    const rect = plot.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(fraction * (points.length - 1));
  }

  function showAt(index: number) {
    const plot = plotRef.current;
    const parent = containerRef.current;
    if (!plot || !parent) return;
    const rect = plot.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    setHoverIndex(index);
    setHover({
      x: rect.left - parentRect.left + (xAt(index) / 100) * rect.width,
      y: rect.top - parentRect.top + (yAt(points[index].value) / 100) * rect.height,
      width: parentRect.width,
      content: points[index].tooltip,
    });
  }

  const active = hoverIndex !== null && hoverIndex < points.length ? points[hoverIndex] : null;

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => {
        setHover(null);
        setHoverIndex(null);
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-ink">{title}</h3>
          <InfoTooltip label={`About ${title.toLowerCase()}`}>
            {trend === "day"
              ? "A running balance for the whole team. Every workday a pilot is on the road adds one; every workday a pilot is at home takes one away. Red off days, weekends and days before a pilot's first day don't move it. Rising means the team is travelling more than it is home."
              : percent
                ? "All pilots' travel workdays over all pilots' workdays, per month (Monday to Friday, minus red off days)."
                : "All pilots' travel days added up per month."}{" "}
            Click the chart to open that month.
          </InfoTooltip>
        </div>
        <div role="group" aria-label="Chart" className="inline-flex rounded-lg border border-glass/15 bg-glass/5 p-0.5 text-[11px]">
          {TRENDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setTrend(option.value);
                setHover(null);
                setHoverIndex(null);
              }}
              aria-pressed={trend === option.value}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                trend === option.value ? "bg-glass/15 text-ink shadow-sm" : "text-ink-3 hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4">
        <div
          ref={plotRef}
          role="img"
          aria-label={`${title}: ${points
            .filter((_, i) => trend === "month" || monthStarts.some((s) => s.index === i))
            .map((p) => `${monthLabel(p.month, MONTH_SHORT)} ${trend === "day" ? signed(p.value) : percent ? `${p.value}%` : p.value}`)
            .join(", ")}`}
          className="relative h-40 cursor-pointer"
          onMouseMove={(event) => {
            const index = indexAt(event.clientX);
            if (index !== null && index !== hoverIndex) showAt(index);
          }}
          onClick={(event) => {
            const index = indexAt(event.clientX);
            if (index !== null) onPick(points[index].month);
          }}
        >
          {trend === "day" && bottom < 0 ? (
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-glass/30" style={{ top: `${zero}%` }}>
              <span className="absolute -left-4 -top-2 text-[10px] text-ink-5">0</span>
            </div>
          ) : null}
          {trend === "day" && bottom < 0 ? (
            <span className="pointer-events-none absolute -left-4 bottom-0 translate-y-1/2 text-[10px] tabular-nums text-ink-5">
              {bottom}
            </span>
          ) : null}
          {trend === "day" && top > 0 ? (
            <span className="pointer-events-none absolute -left-4 top-0 -translate-y-1/2 text-[10px] tabular-nums text-ink-5">
              {signed(top)}
            </span>
          ) : null}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-accent"
          >
            <path d={area} fill="currentColor" opacity={0.12} />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {trend === "month"
            ? points.map((p, i) => (
                <span key={p.key}>
                  <span
                    className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                    style={{ left: `${xAt(i)}%`, top: `${yAt(p.value)}%` }}
                  />
                  <span
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-full pb-1.5 text-[10px] tabular-nums text-ink-4"
                    style={{ left: `${xAt(i)}%`, top: `${yAt(p.value)}%` }}
                  >
                    {p.value ? (percent ? `${p.value}%` : p.value) : ""}
                  </span>
                </span>
              ))
            : null}
          {active && hoverIndex !== null ? (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-glass/30" style={{ left: `${xAt(hoverIndex)}%` }} />
              <span
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-overlay"
                style={{ left: `${xAt(hoverIndex)}%`, top: `${yAt(active.value)}%` }}
              />
            </>
          ) : null}
        </div>
        <div className="relative mt-1.5 h-4">
          {(trend === "month"
            ? points.map((p, i) => ({ key: p.key, index: i, text: p.label }))
            : monthStarts.map((s) => ({ key: s.month, index: s.index, text: monthLabel(s.month, MONTH_SHORT) }))
          ).map((tick) => (
            <span
              key={tick.key}
              className="absolute -translate-x-1/2 text-[10px] text-ink-4"
              style={{ left: `${xAt(tick.index)}%` }}
            >
              {tick.text}
            </span>
          ))}
        </div>
      </div>
      <HoverTooltip hover={hover} />
    </div>
  );
}

