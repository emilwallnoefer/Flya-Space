"use client";

import { useMemo, useRef, useState } from "react";
import { InfoTooltip } from "@/components/info-tooltip";
import { HoverTooltip, type HoverPos } from "../stat-tile";
import { pickTrustedHost } from "../format";
import type { OverviewStatsResponse } from "../types";

export function TopLinksCard({
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

  const rows = useMemo(() => stats?.top_links ?? [], [stats]);
  const max = useMemo(
    () => rows.reduce((acc, row) => Math.max(acc, showBots ? row.real_clicks + row.bot_clicks : row.real_clicks), 0),
    [rows, showBots],
  );

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-glass/10 bg-overlay/30 p-3"
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <h4 className="text-xs font-semibold text-ink">Top links by clicks</h4>
        <InfoTooltip label="About top links">
          Links ranked by real clicks. Hover a bar to see the destination, total sends, and click-through rate.
        </InfoTooltip>
      </div>

      {loading && !stats ? (
        <p className="py-8 text-center text-xs text-ink-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-4">No tracked links yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const visible = showBots ? row.real_clicks + row.bot_clicks : row.real_clicks;
            const widthPct = max > 0 ? Math.max(2, (visible / max) * 100) : 2;
            const ctr = row.sends_count > 0 ? (visible / row.sends_count) * 100 : 0;
            const host = pickTrustedHost(row.original_url);
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
                    height: rect.height,
                    content: (
                      <div className="min-w-[200px]">
                        <div className="font-semibold text-warn">{row.label}</div>
                        <div className="truncate text-ink-3">{host}</div>
                        <div className="mt-1 text-ink-2">
                          {row.real_clicks} real · {row.bot_clicks} scanner
                        </div>
                        <div className="text-ink-4">
                          {row.sends_count} send{row.sends_count === 1 ? "" : "s"} · CTR {ctr.toFixed(ctr >= 10 ? 0 : 1)}%
                        </div>
                      </div>
                    ),
                  });
                }}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink">{row.label}</div>
                  <div className="truncate text-[11px] text-ink-5">{host}</div>
                  <div className="relative mt-0.5 h-2 overflow-hidden rounded bg-glass/5">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-emerald-400/80"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-positive">{visible}</span>
              </li>
            );
          })}
        </ul>
      )}
      <HoverTooltip hover={hover} anchor={containerRef} />
    </div>
  );
}
