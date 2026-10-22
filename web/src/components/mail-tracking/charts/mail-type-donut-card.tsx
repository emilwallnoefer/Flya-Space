"use client";

import { useMemo, useRef, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { HoverTooltip, type HoverPos } from "../stat-tile";
import { DONUT_COLORS, type MailTypeRow, type OverviewStatsResponse } from "../types";

export function MailTypeDonutCard({
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

  const rows = useMemo(() => stats?.mail_type_breakdown ?? [], [stats]);
  const total = useMemo(() => rows.reduce((acc, row) => acc + row.sends_count, 0), [rows]);

  const segments = useMemo(() => {
    if (total <= 0) return [] as Array<{ row: MailTypeRow; start: number; end: number; color: string }>;
    let cursor = 0;
    return rows.map((row, idx) => {
      const fraction = row.sends_count / total;
      const start = cursor;
      const end = cursor + fraction;
      cursor = end;
      return { row, start, end, color: DONUT_COLORS[idx % DONUT_COLORS.length] };
    });
  }, [rows, total]);

  const radius = 60;
  const inner = 36;
  const cx = 70;
  const cy = 70;

  function arcPath(start: number, end: number) {
    if (end - start >= 1) {
      return [
        `M ${cx - radius} ${cy}`,
        `A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy}`,
        `A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy}`,
        `M ${cx - inner} ${cy}`,
        `A ${inner} ${inner} 0 1 0 ${cx + inner} ${cy}`,
        `A ${inner} ${inner} 0 1 0 ${cx - inner} ${cy}`,
        "Z",
      ].join(" ");
    }
    const a0 = start * Math.PI * 2 - Math.PI / 2;
    const a1 = end * Math.PI * 2 - Math.PI / 2;
    const large = end - start > 0.5 ? 1 : 0;
    const x0 = cx + Math.cos(a0) * radius;
    const y0 = cy + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const y1 = cy + Math.sin(a1) * radius;
    const xi0 = cx + Math.cos(a0) * inner;
    const yi0 = cy + Math.sin(a0) * inner;
    const xi1 = cx + Math.cos(a1) * inner;
    const yi1 = cy + Math.sin(a1) * inner;
    return [
      `M ${x0} ${y0}`,
      `A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi1} ${yi1}`,
      `A ${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0}`,
      "Z",
    ].join(" ");
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <h4 className="text-xs font-semibold text-ink">Mail type mix</h4>
        <InfoTooltip label="About mail type donut">
          Distribution of tracked sends by mail_type. Hover a segment for send count, real and scanner clicks.
        </InfoTooltip>
      </div>

      {loading && !stats ? (
        <p className="py-8 text-center text-xs text-ink-4">Loading…</p>
      ) : total === 0 ? (
        <p className="py-8 text-center text-xs text-ink-4">No sends in this window yet.</p>
      ) : (
        <div className="flex gap-3">
          <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
            {segments.map((segment, idx) => (
              <path
                key={`${segment.row.mail_type}-${idx}`}
                d={arcPath(segment.start, segment.end)}
                fill={segment.color}
                opacity={0.85}
                className="transition hover:opacity-100"
                onMouseEnter={(event) => {
                  const parent = containerRef.current;
                  if (!parent) return;
                  const rect = (event.currentTarget as SVGPathElement).getBoundingClientRect();
                  const parentRect = parent.getBoundingClientRect();
                  const visibleClicks = showBots
                    ? segment.row.real_clicks + segment.row.bot_clicks
                    : segment.row.real_clicks;
                  const ctr = segment.row.sends_count > 0 ? (visibleClicks / segment.row.sends_count) * 100 : 0;
                  setHover({
                    x: rect.left - parentRect.left + rect.width / 2,
                    y: rect.top - parentRect.top,
                    height: rect.height,
                    content: (
                      <div className="min-w-[180px]">
                        <div className="font-semibold" style={{ color: segment.color }}>
                          {segment.row.mail_type}
                        </div>
                        <div className="text-ink-2">
                          {segment.row.sends_count} send{segment.row.sends_count === 1 ? "" : "s"} ({((segment.end - segment.start) * 100).toFixed(1)}%)
                        </div>
                        <div className="text-ink-3">{segment.row.real_clicks} real clicks</div>
                        <div className="text-ink-4">{segment.row.bot_clicks} scanner</div>
                        <div className="text-ink-4">CTR {ctr.toFixed(ctr >= 10 ? 0 : 1)}%</div>
                      </div>
                    ),
                  });
                }}
              />
            ))}
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-100 text-[14px] font-semibold">
              {total}
            </text>
            <text x={cx} y={cy + 10} textAnchor="middle" className="fill-slate-400 text-[8px] uppercase tracking-wider">
              sends
            </text>
          </svg>
          <ul className="min-w-0 flex-1 space-y-1 self-center">
            {segments.map((segment, idx) => (
              <li key={`${segment.row.mail_type}-legend-${idx}`} className="flex items-center gap-2 text-[11px]">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="min-w-0 flex-1 truncate text-ink-2">{segment.row.mail_type}</span>
                <span className="shrink-0 tabular-nums text-ink-4">{segment.row.sends_count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <HoverTooltip hover={hover} anchor={containerRef} />
    </div>
  );
}
