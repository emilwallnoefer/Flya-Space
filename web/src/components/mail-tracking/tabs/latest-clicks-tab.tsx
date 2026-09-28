"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FreshnessPill } from "@/components/freshness-pill";
import { Badge, ButtonLink, Notice } from "@/components/ui";
import { fmtAbsolute, fmtRelative, parseUserAgent, pickTrustedHost } from "../format";
import type { LatestClick, LatestClicksResponse } from "../types";

const LATEST_PAGE_SIZE = 10;
const LATEST_RANGE_OPTIONS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function LatestClicksTab({ showBots }: { showBots: boolean }) {
  const [days, setDays] = useState(7);
  const [clicks, setClicks] = useState<LatestClick[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (opts: { append: boolean; offset: number }) => {
      const requestId = ++requestIdRef.current;
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          days: String(days),
          offset: String(opts.offset),
          limit: String(LATEST_PAGE_SIZE),
        });
        if (showBots) params.set("include_bots", "1");
        const response = await fetch(`/api/admin/mail-tracking/clicks?${params.toString()}`);
        const payload = (await response.json()) as LatestClicksResponse | { error: string };
        if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load clicks.");
        if (requestId !== requestIdRef.current) return;
        const data = payload as LatestClicksResponse;
        setClicks((prev) => (opts.append ? [...prev, ...data.clicks] : data.clicks));
        setTotal(data.total);
        setUpdatedAt(Date.now());
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError((err as Error).message || "Failed to load clicks.");
      } finally {
        if (requestId !== requestIdRef.current) return;
        if (opts.append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [days, showBots],
  );

  useEffect(() => {
    void fetchPage({ append: false, offset: 0 });
  }, [fetchPage]);

  const hasMore = clicks.length < total;
  const csvParams = new URLSearchParams({ days: String(days), format: "csv" });
  if (showBots) csvParams.set("include_bots", "1");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-glass/10 bg-overlay/50 p-0.5 text-sm">
          {LATEST_RANGE_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => setDays(option.days)}
              className={`inline-flex min-h-10 min-w-12 items-center justify-center rounded-md px-4 py-2 transition ${
                days === option.days
                  ? "bg-amber-400/15 text-warn"
                  : "text-ink-3 hover:text-ink"
              }`}
              aria-pressed={days === option.days}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink
            variant="glass-quiet"
            size="sm"
            disabled={clicks.length === 0}
            href={`/api/admin/mail-tracking/clicks?${csvParams.toString()}`}
          >
            Export CSV
          </ButtonLink>
          <FreshnessPill updatedAt={updatedAt} loading={loading} />
        </div>
      </div>

      <p className="text-[11px] text-ink-4">
        Last {days === 1 ? "24 hours" : `${days} days`}
        {showBots ? " · scanners included" : " · scanners hidden"}
        {total > 0 ? ` · ${total} click${total === 1 ? "" : "s"} total` : ""}
      </p>

      {error ? <Notice>{error}</Notice> : null}

      {loading && clicks.length === 0 ? (
        <div className="rounded-xl border border-glass/10 bg-glass/5 px-3 py-10 text-center text-sm text-ink-3/80">
          Loading clicks…
        </div>
      ) : clicks.length === 0 ? (
        <div className="rounded-xl border border-glass/10 bg-glass/5 px-3 py-10 text-center text-sm text-ink-3/80">
          No tracked clicks in the last {days === 1 ? "24 hours" : `${days} days`}.
          {!showBots ? " Toggle Scanners to include corporate link scanners." : ""}
        </div>
      ) : (
        <ul className="space-y-2">
          {clicks.map((click) => (
            <LatestClickCard key={click.id} click={click} />
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void fetchPage({ append: true, offset: clicks.length })}
            disabled={loadingMore}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-glass/15 bg-glass/5 px-4 py-2 text-xs text-ink-2 transition hover:bg-glass/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : `Load ${Math.min(LATEST_PAGE_SIZE, total - clicks.length)} more`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function LatestClickCard({ click }: { click: LatestClick }) {
  const ua = parseUserAgent(click.user_agent);
  const linkLabel = click.link
    ? click.link.link_label || click.link.link_key || pickTrustedHost(click.link.original_url)
    : "Unknown link";
  const linkHost = click.link ? pickTrustedHost(click.link.original_url) : null;
  const recipient = click.send;

  return (
    <li className="rounded-xl border border-glass/10 bg-glass/5 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold tabular-nums text-ink" title={fmtAbsolute(click.clicked_at)}>
            {fmtRelative(click.clicked_at)}
          </span>
          <span className="text-[11px] text-ink-5">{fmtAbsolute(click.clicked_at)}</span>
          {click.is_likely_bot ? (
            <Badge tone="neutral">scanner</Badge>
          ) : (
            <Badge tone="warn">real click</Badge>
          )}
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.15em] text-ink-3/60">Recipient</p>
          {recipient ? (
            <>
              <p className="truncate text-sm text-ink">{recipient.recipient_name}</p>
              <p className="truncate text-[11px] text-ink-4">
                {recipient.company_name ?? "—"}
                {recipient.recipient_email ? ` · ${recipient.recipient_email}` : ""}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-ink-5" title={recipient.subject}>
                {recipient.mail_type} · {recipient.subject}
              </p>
            </>
          ) : (
            <p className="text-xs text-ink-5">Send no longer available</p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.15em] text-ink-3/60">Link</p>
          {click.link ? (
            <a
              href={click.link.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block min-w-0 text-sm text-ink hover:text-warn"
              title={click.link.original_url}
            >
              <span className="block truncate font-medium">{linkLabel}</span>
              <span className="block truncate text-[11px] text-ink-4">{linkHost}</span>
            </a>
          ) : (
            <p className="text-xs text-ink-5">Link no longer available</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] ${
                ua.kind === "scanner"
                  ? "bg-neutral/35 text-ink-2"
                  : ua.kind === "browser"
                    ? "bg-emerald-500/10 text-positive"
                    : "bg-neutral/25 text-ink-3"
              }`}
              title={click.user_agent ?? "No user agent recorded"}
            >
              {ua.label}
            </span>
            {click.user_agent ? (
              <span className="truncate text-[11px] text-ink-5" title={click.user_agent}>
                {click.user_agent}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
