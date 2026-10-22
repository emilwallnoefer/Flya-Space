"use client";

import { useMemo, useRef, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { HoverTooltip, type HoverPos } from "../stat-tile";
import { DOW_LABELS, type OverviewStatsResponse } from "../types";

const HOUR_GRID_STYLE = { display: "grid", gridTemplateColumns: "repeat(24, minmax(0, 1fr))", gap: "2px" } as const;

export function HeatmapCard({
  stats,
  loading,
  showBots,
}: {
  stats: OverviewStatsResponse | null;
  loading: boolean;
  showBots: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverPos>(null);

  const grid = useMemo(() => {
    if (!stats) return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    return stats.heatmap.map((row, dow) =>
      row.map((value, hour) => (showBots ? value + (stats.heatmap_bots?.[dow]?.[hour] ?? 0) : value)),
    );
  }, [stats, showBots]);

  const max = useMemo(() => grid.reduce((acc, row) => row.reduce((acc2, v) => Math.max(acc2, v), acc), 0), [grid]);
  const totalClicks = useMemo(() => grid.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0), [grid]);

  const peak = useMemo(() => {
    let best = { dow: 0, hour: 0, count: 0 };
    grid.forEach((row, dow) => {
      row.forEach((count, hour) => {
        if (count > best.count) best = { dow, hour, count };
      });
    });
    return best;
  }, [grid]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-semibold text-ink">When do clicks happen?</h4>
          <InfoTooltip label="About click heatmap" align="start">
            Every tracked click bucketed by weekday × local hour. Brighter cells mean more clicks. The fun
            one: it tells you whether your recipients are reading during work hours, after dinner, or 2am.
          </InfoTooltip>
        </div>
        <p className="text-[11px] text-ink-4">
          {loading && !stats
            ? "Loading…"
            : totalClicks > 0
              ? `Peak: ${DOW_LABELS[peak.dow]} ${String(peak.hour).padStart(2, "0")}:00 (${peak.count} click${peak.count === 1 ? "" : "s"})`
              : "No clicks in this window yet"}
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        <div className="flex flex-col justify-around pr-1 pt-[18px]">
          {DOW_LABELS.map((label) => (
            <span key={label} className="text-[11px] uppercase tracking-wider text-ink-5">
              {label}
            </span>
          ))}
        </div>
        <div className="min-w-[640px] flex-1">
          <div className="mb-1 text-center" style={HOUR_GRID_STYLE}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className={`text-[11px] text-ink-5 ${hour % 3 === 0 ? "" : "opacity-0"}`}
              >
                {String(hour).padStart(2, "0")}
              </span>
            ))}
          </div>
          <div className="space-y-[2px]">
            {grid.map((row, dow) => (
              <div key={dow} style={HOUR_GRID_STYLE}>
                {row.map((count, hour) => {
                  const intensity = max > 0 ? count / max : 0;
                  const alpha = count === 0 ? 0.04 : 0.18 + intensity * 0.82;
                  return (
                    <button
                      key={hour}
                      type="button"
                      tabIndex={-1}
                      className="aspect-square min-h-3 rounded-[2px] transition focus:outline-none"
                      style={{ backgroundColor: `rgba(251, 191, 36, ${alpha})` }}
                      onMouseEnter={(event) => {
                        const target = event.currentTarget;
                        const parent = containerRef.current;
                        if (!parent) return;
                        const rect = target.getBoundingClientRect();
                        const parentRect = parent.getBoundingClientRect();
                              const realCount = stats?.heatmap?.[dow]?.[hour] ?? 0;
                        const botCount = stats?.heatmap_bots?.[dow]?.[hour] ?? 0;
                        setHover({
                          x: rect.left - parentRect.left + rect.width / 2,
                          y: rect.top - parentRect.top,
                          height: rect.height,
                          content: (
                            <div>
                              <div className="font-semibold text-warn">
                                {DOW_LABELS[dow]} · {String(hour).padStart(2, "0")}:00–{String(hour + 1).padStart(2, "0")}:00
                              </div>
                              <div className="text-ink-2">{realCount} real click{realCount === 1 ? "" : "s"}</div>
                              <div className="text-ink-4">{botCount} scanner</div>
                              <div className="text-ink-5">{count} visible</div>
                            </div>
                          ),
                        });
                      }}
                    >
                      <span className="sr-only">
                        {DOW_LABELS[dow]} {hour}:00, {count} clicks
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-5">
        Times are the click viewer&apos;s local hour (yours, looking at this dashboard).
      </p>
      <HoverTooltip hover={hover} anchor={containerRef} />
    </div>
  );
}
