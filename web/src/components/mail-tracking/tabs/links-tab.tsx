"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FreshnessPill } from "@/components/freshness-pill";
import { Notice } from "@/components/ui";
import { StatTile } from "../stat-tile";
import { fmtAbsolute, fmtRelative, pickTrustedHost } from "../format";
import type { LinkLeaderboardResponse, LinkLeaderboardRow } from "../types";

async function requestLinks(): Promise<LinkLeaderboardResponse> {
  const response = await fetch("/api/admin/mail-tracking/links");
  const payload = (await response.json()) as LinkLeaderboardResponse | { error: string };
  if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load links.");
  return payload as LinkLeaderboardResponse;
}

export function LinksTab({ showBots }: { showBots: boolean }) {
  const [search, setSearch] = useState("");
  const [linkData, setLinkData] = useState<LinkLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Loads once on mount; state changes only in the promise callbacks, and
  // `loading` starts out true instead of being set here.
  const load = useCallback(
    () =>
      requestLinks()
        .then(
          (data) => {
            setLinkData(data);
            setUpdatedAt(Date.now());
          },
          (err: Error) => setError(err.message || "Failed to load links."),
        )
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const linkSearch = search.trim().toLowerCase();
  const filteredLinks = useMemo(() => {
    if (!linkData) return [];
    if (!linkSearch) return linkData.links;
    return linkData.links.filter((link) =>
      (link.label ?? "").toLowerCase().includes(linkSearch) ||
      (link.link_key ?? "").toLowerCase().includes(linkSearch) ||
      link.original_url.toLowerCase().includes(linkSearch),
    );
  }, [linkData, linkSearch]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search link, label or URL"
            className="w-full rounded-lg border border-glass/15 bg-panel/60 px-3 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-amber-300/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-ink-4">All time across every tracked send</p>
        <FreshnessPill updatedAt={updatedAt} loading={loading} />
      </div>

      {error ? <Notice>{error}</Notice> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Unique links"
          value={linkData?.totals.unique_links ?? 0}
          hint="All time"
          info="Distinct destinations across every tracked send, grouped by link_key when present, otherwise by original URL."
        />
        <StatTile
          label="Total link sends"
          value={linkData?.totals.total_link_rows ?? 0}
          hint="Per email"
          info="Total rows in mail_send_links, each link counted once per email it was inserted into."
        />
        <StatTile
          label="Real clicks"
          value={linkData?.totals.real_clicks ?? 0}
          hint="Humans"
          info="Clicks that did not match the scanner heuristic."
        />
        <StatTile
          label="Scanner clicks"
          value={linkData?.totals.bot_clicks ?? 0}
          hint="Bots"
          info="Likely corporate link scanners: Outlook ATP, Mimecast, Proofpoint, etc."
        />
      </div>

      <LinkLeaderboardTable
        rows={filteredLinks}
        loading={loading}
        hasData={Boolean(linkData)}
        showBots={showBots}
      />
    </section>
  );
}

function LinkLeaderboardTable({
  rows,
  loading,
  hasData,
  showBots,
}: {
  rows: LinkLeaderboardRow[];
  loading: boolean;
  hasData: boolean;
  showBots: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-glass/10 bg-glass/5">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-glass/5 text-xs uppercase tracking-wider text-ink-3/80">
          <tr>
            <th className="px-3 py-2">Link</th>
            <th className="px-3 py-2 text-right">Sent in</th>
            <th className="px-3 py-2 text-right">Clicks</th>
            <th className="px-3 py-2 text-right">CTR</th>
            <th className="px-3 py-2 text-right">Last click</th>
          </tr>
        </thead>
        <tbody>
          {loading && !hasData ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-3/80">
                Loading link leaderboard…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-3/80">
                No tracked links yet. Send a Gmail draft from the generator to start collecting clicks.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const total = showBots ? row.real_clicks + row.bot_clicks : row.real_clicks;
              const botSuffix = showBots || row.bot_clicks === 0 ? "" : ` +${row.bot_clicks} scanner`;
              const ctr = row.sends_count > 0 ? total / row.sends_count : 0;
              const ctrLabel = row.sends_count > 0 ? `${(ctr * 100).toFixed(ctr >= 0.1 ? 0 : 1)}%` : "—";
              const displayLabel = row.label || row.link_key || pickTrustedHost(row.original_url);
              return (
                <tr key={row.key} className="border-t border-glass/5 align-middle">
                  <td className="px-3 py-2">
                    <a
                      href={row.original_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block min-w-0"
                      title={row.original_url}
                    >
                      <div className="truncate text-sm text-ink hover:text-warn">
                        {displayLabel}
                      </div>
                      <div className="truncate text-[11px] text-ink-5">
                        {row.link_key ? (
                          <span className="mr-2 rounded bg-glass/5 px-1 py-0.5 text-[11px] uppercase tracking-wider text-ink-4">
                            {row.link_key}
                          </span>
                        ) : null}
                        {pickTrustedHost(row.original_url)}
                      </div>
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">
                    {row.sends_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={total > 0 ? "text-warn" : "text-ink-4"}>{total}</span>
                    {botSuffix ? (
                      <span className="ml-1 text-[11px] text-ink-5">{botSuffix}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">{ctrLabel}</td>
                  <td
                    className="px-3 py-2 text-right text-xs text-ink-3"
                    title={fmtAbsolute(row.last_click_at)}
                  >
                    {fmtRelative(row.last_click_at)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
