"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { StatTile } from "../stat-tile";
import { formatBucketFullLabel, formatBucketTick, shouldShowBucketTick } from "../format";
import type { TimelineBucket, TimelinePeriod, TimelineResponse } from "../types";

export function MailClickTimelineChart({
  data,
  loading,
  period,
  showBots,
}: {
  data: TimelineResponse | null;
  loading: boolean;
  period: TimelinePeriod;
  showBots: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number; w: number; h: number } | null>(null);

  const handlePointer = useCallback((index: number, event: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      index,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    });
  }, []);

  if (loading && !data) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-glass/10 bg-overlay/40 text-sm text-ink-3/80">
        Loading click timeline...
      </div>
    );
  }

  const buckets = data?.buckets ?? [];
  if (buckets.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-glass/10 bg-overlay/40 px-6 text-center text-sm text-ink-3/80">
        No tracked click activity yet for this period.
      </div>
    );
  }

  const width = 920;
  const height = 288;
  const marginTop = 16;
  const marginRight = 18;
  const marginBottom = 42;
  const marginLeft = 42;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  const gap = Math.max(2, Math.floor(plotWidth / Math.max(1, buckets.length * 5)));
  const barWidth = Math.max(6, (plotWidth - gap * (buckets.length - 1)) / buckets.length);
  const maxVisible = Math.max(
    1,
    ...buckets.map((bucket) => (showBots ? bucket.real_clicks + bucket.bot_clicks : bucket.real_clicks)),
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile
          label="Visible clicks"
          value={showBots ? (data?.totals.real_clicks ?? 0) + (data?.totals.bot_clicks ?? 0) : data?.totals.real_clicks ?? 0}
          hint={showBots ? "Real + scanners" : "Real only"}
        />
        <StatTile label="Mails sent" value={data?.totals.mails_sent ?? 0} hint="Same period" />
        <StatTile label="Scanner clicks" value={data?.totals.bot_clicks ?? 0} hint="Hidden unless enabled" />
      </div>

      <div ref={containerRef} className="relative">
      <div
        className="overflow-x-auto rounded-xl border border-glass/10 bg-overlay/40 p-3"
        onMouseLeave={() => setHover(null)}
      >
        <div className="min-w-[720px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Mail click timeline chart">
            {Array.from({ length: 4 }, (_, index) => {
              const value = Math.round((maxVisible * (4 - index)) / 4);
              const y = marginTop + (plotHeight * index) / 4;
              return (
                <g key={`gridline-${index}-${value}`}>
                  <line
                    x1={marginLeft}
                    x2={width - marginRight}
                    y1={y}
                    y2={y}
                    className="stroke-glass/10"
                    strokeWidth="1"
                  />
                  <text x={marginLeft - 8} y={y + 4} textAnchor="end" className="fill-ink-5 text-[11px]">
                    {value}
                  </text>
                </g>
              );
            })}

            {buckets.map((bucket, index) => {
              const x = marginLeft + index * (barWidth + gap);
              const realHeight = (plotHeight * bucket.real_clicks) / maxVisible;
              const botHeight = showBots ? (plotHeight * bucket.bot_clicks) / maxVisible : 0;
              const totalHeight = realHeight + botHeight;
              const y = marginTop + plotHeight - totalHeight;
              const realY = marginTop + plotHeight - realHeight;
              const label = formatBucketTick(bucket.bucket_start, period);
              const isHovered = hover?.index === index;
              // Full-height transparent hit area so the whole column is hoverable,
              // not just the (often short) bar itself.
              const hitX = marginLeft + index * (barWidth + gap) - gap / 2;
              const hitWidth = barWidth + gap;
              return (
                <g key={bucket.bucket_start}>
                  {isHovered ? (
                    <rect
                      x={hitX}
                      y={marginTop}
                      width={hitWidth}
                      height={plotHeight}
                      className="fill-white/5"
                    />
                  ) : null}
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(totalHeight, 2)}
                    rx="4"
                    className="fill-amber-500/25"
                  />
                  <rect
                    x={x}
                    y={realY}
                    width={barWidth}
                    height={Math.max(realHeight, 2)}
                    rx="4"
                    className="fill-amber-300"
                  />
                  {showBots && bucket.bot_clicks > 0 ? (
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(botHeight, 2)}
                      rx="4"
                      className="fill-ink-5/80"
                    />
                  ) : null}
                  {shouldShowBucketTick(index, buckets.length, period) ? (
                    <text
                      x={x + barWidth / 2}
                      y={height - 14}
                      textAnchor="middle"
                      className="fill-ink-5 text-[11px]"
                    >
                      {label}
                    </text>
                  ) : null}
                  <rect
                    x={hitX}
                    y={marginTop}
                    width={hitWidth}
                    height={plotHeight}
                    className="cursor-pointer fill-transparent"
                    onMouseEnter={(event) => handlePointer(index, event)}
                    onMouseMove={(event) => handlePointer(index, event)}
                    onTouchStart={(event) => {
                      const touch = event.touches[0];
                      if (touch) handlePointer(index, touch);
                    }}
                  />
                </g>
              );
            })}

            <line
              x1={marginLeft}
              x2={width - marginRight}
              y1={marginTop + plotHeight}
              y2={marginTop + plotHeight}
              className="stroke-glass/15"
              strokeWidth="1"
            />
          </svg>
        </div>
      </div>
        {hover && buckets[hover.index] ? (
          <TimelineTooltip
            bucket={buckets[hover.index]}
            period={period}
            showBots={showBots}
            x={hover.x}
            y={hover.y}
            containerWidth={hover.w}
            containerHeight={hover.h}
          />
        ) : null}
      </div>

      <p className="text-[11px] text-ink-4">
        X-axis: time. Y-axis: clicks from all tracked emails and links. Amber shows real clicks; gray adds scanner clicks when enabled. Hover a column to see which mails the clicks came from.
      </p>
    </div>
  );
}

function TimelineTooltip({
  bucket,
  period,
  showBots,
  x,
  y,
  containerWidth,
  containerHeight,
}: {
  bucket: TimelineBucket;
  period: TimelinePeriod;
  showBots: boolean;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
}) {
  const visibleClicks = showBots ? bucket.real_clicks + bucket.bot_clicks : bucket.real_clicks;
  const mails = (bucket.mails ?? []).filter((mail) =>
    showBots ? mail.real_clicks + mail.bot_clicks > 0 : mail.real_clicks > 0,
  );

  // Flip horizontally past the midpoint, and place above the pointer when it is
  // in the lower half — keeps the card inside the chart area.
  const alignRight = x > containerWidth / 2;
  const placeAbove = y > containerHeight / 2;
  const style: CSSProperties = {
    left: alignRight ? undefined : x + 12,
    right: alignRight ? containerWidth - x + 12 : undefined,
    top: placeAbove ? undefined : y + 12,
    bottom: placeAbove ? containerHeight - y + 12 : undefined,
  };

  return (
    <div
      className="pointer-events-none absolute z-20 w-64 rounded-lg border border-glass/15 bg-surface/95 p-3 text-xs shadow-xl shadow-shade/40"
      style={style}
    >
      <p className="font-semibold text-ink">{formatBucketFullLabel(bucket.bucket_start, period)}</p>
      <p className="mt-0.5 text-[11px] text-ink-4">
        <span className="text-warn">{visibleClicks}</span> {showBots ? "click" : "real click"}
        {visibleClicks === 1 ? "" : "s"}
        {!showBots && bucket.bot_clicks > 0 ? (
          <span className="text-ink-5"> · +{bucket.bot_clicks} scanner</span>
        ) : null}
        <span className="text-ink-5"> · {bucket.mails_sent} sent</span>
      </p>
      {mails.length > 0 ? (
        <ul className="mt-2 space-y-1.5 border-t border-glass/10 pt-2">
          {mails.map((mail) => {
            const mailClicks = showBots ? mail.real_clicks + mail.bot_clicks : mail.real_clicks;
            return (
              <li key={mail.send_id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-ink">{mail.recipient_name}</p>
                  <p className="truncate text-[11px] text-ink-5">
                    {mail.company_name ? `${mail.company_name} · ` : ""}
                    {mail.subject}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-warn">{mailClicks}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 border-t border-glass/10 pt-2 text-[11px] text-ink-5">
          {visibleClicks > 0
            ? "Click sources unavailable for this bucket."
            : "No clicks in this period."}
        </p>
      )}
    </div>
  );
}
