"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { FreshnessPill } from "@/components/freshness-pill";
import { Notice } from "@/components/ui";
import { HeatmapCard } from "../charts/heatmap-card";
import { MailClickTimelineChart } from "../charts/timeline-chart";
import { MailTypeDonutCard } from "../charts/mail-type-donut-card";
import { TopLinksCard } from "../charts/top-links-card";
import { TopRecipientsCard } from "../charts/top-recipients-card";
import {
  formatTimelineRangeLabel,
  fromDateKey,
  periodResetLabel,
  shiftPeriod,
  startOfPeriod,
  toDateKey,
} from "../format";
import { STATS_RANGE_OPTIONS, type OverviewStatsResponse, type TimelinePeriod, type TimelineResponse } from "../types";

async function requestTimeline(period: TimelinePeriod, anchor: string): Promise<TimelineResponse> {
  const params = new URLSearchParams({ period, anchor });
  const response = await fetch(`/api/admin/mail-tracking/timeline?${params.toString()}`);
  const payload = (await response.json()) as TimelineResponse | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load timeline.");
  return payload as TimelineResponse;
}

async function requestOverviewStats(days: number): Promise<OverviewStatsResponse> {
  const params = new URLSearchParams({ days: String(days) });
  const response = await fetch(`/api/admin/mail-tracking/overview-stats?${params.toString()}`);
  const payload = (await response.json()) as OverviewStatsResponse | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load stats.");
  return payload as OverviewStatsResponse;
}

export function OverviewTab({ showBots }: { showBots: boolean }) {
  const [timelinePeriod, setTimelinePeriod] = useState<TimelinePeriod>("week");
  const [timelineAnchor, setTimelineAnchor] = useState<string>(toDateKey(startOfPeriod(new Date(), "week")));
  const [timelineData, setTimelineData] = useState<TimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineUpdatedAt, setTimelineUpdatedAt] = useState<number | null>(null);

  const [statsDays, setStatsDays] = useState(90);
  const [stats, setStats] = useState<OverviewStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<number | null>(null);

  // A new period, anchor or range starts in the loading state. This happens
  // during render because the effects below may not set state themselves.
  const timelineKey = `${timelinePeriod}:${timelineAnchor}`;
  const [shownTimelineKey, setShownTimelineKey] = useState(timelineKey);
  if (shownTimelineKey !== timelineKey) {
    setShownTimelineKey(timelineKey);
    setTimelineLoading(true);
    setTimelineError(null);
  }
  const [shownStatsDays, setShownStatsDays] = useState(statsDays);
  if (shownStatsDays !== statsDays) {
    setShownStatsDays(statsDays);
    setStatsLoading(true);
    setStatsError(null);
  }

  const loadTimeline = useCallback(
    (period: TimelinePeriod, anchor: string) =>
      requestTimeline(period, anchor)
        .then(
          (data) => {
            setTimelineData(data);
            setTimelineUpdatedAt(Date.now());
          },
          (err: Error) => setTimelineError(err.message || "Failed to load timeline."),
        )
        .finally(() => setTimelineLoading(false)),
    [],
  );

  const loadStats = useCallback(
    (days: number) =>
      requestOverviewStats(days)
        .then(
          (data) => {
            setStats(data);
            setStatsUpdatedAt(Date.now());
          },
          (err: Error) => setStatsError(err.message || "Failed to load stats."),
        )
        .finally(() => setStatsLoading(false)),
    [],
  );

  useEffect(() => {
    void loadTimeline(timelinePeriod, timelineAnchor);
  }, [loadTimeline, timelinePeriod, timelineAnchor]);

  useEffect(() => {
    void loadStats(statsDays);
  }, [loadStats, statsDays]);

  const timelineRangeLabel = useMemo(
    () => formatTimelineRangeLabel(timelineAnchor, timelinePeriod),
    [timelineAnchor, timelinePeriod],
  );

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-glass/10 bg-glass/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-ink">Click timeline</h3>
              <InfoTooltip label="About click timeline">
                Aggregated click activity across all tracked emails and links. X is time, Y is clicks.
              </InfoTooltip>
            </div>
            <p className="mt-1 text-xs text-ink-4">{timelineRangeLabel}</p>
            <div className="mt-2">
              <FreshnessPill updatedAt={timelineUpdatedAt} loading={timelineLoading} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex rounded-lg border border-glass/10 bg-overlay/50 p-0.5 text-sm">
              {(["day", "week", "month", "year"] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => {
                    setTimelineAnchor((prev) => toDateKey(startOfPeriod(fromDateKey(prev), period)));
                    setTimelinePeriod(period);
                  }}
                  className={`inline-flex min-h-10 min-w-12 items-center justify-center rounded-md px-4 py-2 transition ${
                    timelinePeriod === period
                      ? "bg-amber-400/15 text-warn"
                      : "text-ink-3 hover:text-ink"
                  }`}
                  aria-pressed={timelinePeriod === period}
                >
                  {period[0].toUpperCase() + period.slice(1)}
                </button>
              ))}
            </div>
            <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-glass/15 bg-overlay/50 text-sm">
              <button
                type="button"
                onClick={() => setTimelineAnchor((prev) => shiftPeriod(prev, timelinePeriod, -1))}
                className="inline-flex min-h-10 min-w-10 items-center justify-center px-3 py-2 text-ink-2 transition hover:bg-glass/10"
                aria-label={`Previous ${timelinePeriod}`}
              >
                <span aria-hidden>&larr;</span>
              </button>
              <button
                type="button"
                onClick={() => setTimelineAnchor(toDateKey(startOfPeriod(new Date(), timelinePeriod)))}
                className="inline-flex min-h-10 items-center justify-center border-x border-glass/10 px-4 py-2 text-ink-2 transition hover:bg-glass/10"
              >
                {periodResetLabel(timelinePeriod)}
              </button>
              <button
                type="button"
                onClick={() => setTimelineAnchor((prev) => shiftPeriod(prev, timelinePeriod, 1))}
                className="inline-flex min-h-10 min-w-10 items-center justify-center px-3 py-2 text-ink-2 transition hover:bg-glass/10"
                aria-label={`Next ${timelinePeriod}`}
              >
                <span aria-hidden>&rarr;</span>
              </button>
            </div>
          </div>
        </div>

        {timelineError ? <Notice>{timelineError}</Notice> : null}

        <MailClickTimelineChart
          data={timelineData}
          loading={timelineLoading}
          period={timelinePeriod}
          showBots={showBots}
        />
      </section>

      <section className="space-y-4 rounded-xl border border-glass/10 bg-glass/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Engagement breakdown</h3>
            <p className="mt-1 text-xs text-ink-4">
              {stats
                ? `Last ${statsDays === 365 ? "year" : `${statsDays} days`} · ${stats.totals.sends_count} sends · ${stats.totals.real_clicks} real, ${stats.totals.bot_clicks} scanner clicks`
                : `Last ${statsDays === 365 ? "year" : `${statsDays} days`}`}
            </p>
            <div className="mt-2">
              <FreshnessPill updatedAt={statsUpdatedAt} loading={statsLoading} />
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-glass/10 bg-overlay/50 p-0.5 text-sm">
            {STATS_RANGE_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                onClick={() => setStatsDays(option.days)}
                className={`inline-flex min-h-10 min-w-12 items-center justify-center rounded-md px-4 py-2 transition ${
                  statsDays === option.days
                    ? "bg-amber-400/15 text-warn"
                    : "text-ink-3 hover:text-ink"
                }`}
                aria-pressed={statsDays === option.days}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {statsError ? <Notice>{statsError}</Notice> : null}

        {stats?.totals.sends_truncated ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-warn">
            Sends fetch was capped, so the breakdowns reflect the most recent slice of this window.
          </p>
        ) : null}

        <HeatmapCard stats={stats} loading={statsLoading} showBots={showBots} />

        <div className="grid gap-4 lg:grid-cols-3">
          <TopRecipientsCard stats={stats} loading={statsLoading} showBots={showBots} />
          <TopLinksCard stats={stats} loading={statsLoading} showBots={showBots} />
          <MailTypeDonutCard stats={stats} loading={statsLoading} showBots={showBots} />
        </div>
      </section>
    </div>
  );
}
