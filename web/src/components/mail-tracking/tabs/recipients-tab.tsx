"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FreshnessPill } from "@/components/freshness-pill";
import { Badge, ButtonLink, Notice } from "@/components/ui";
import { StatTile } from "../stat-tile";
import { fmtAbsolute, fmtRelative, pickTrustedHost } from "../format";
import type {
  ClickDetail,
  OverviewResponse,
  Recipient,
  SendDetailLink,
  SendDetailResponse,
} from "../types";

const RECIPIENTS_PAGE_SIZE = 10;

export function RecipientsTab({ showBots }: { showBots: boolean }) {
  const [search, setSearch] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<OverviewResponse["totals"] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailBySend, setDetailBySend] = useState<Record<string, SendDetailResponse | "loading" | { error: string }>>(
    {},
  );
  const requestIdRef = useRef(0);
  const loadedCountRef = useRef(0);

  useEffect(() => {
    loadedCountRef.current = recipients.length;
  }, [recipients]);

  // Latest recipients ordered by recency, paged with offset/limit.
  const fetchRecent = useCallback(
    async (opts: { offset: number; limit: number; append: boolean }) => {
      const requestId = ++requestIdRef.current;
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          mode: "recent",
          offset: String(opts.offset),
          limit: String(opts.limit),
        });
        const response = await fetch(`/api/admin/mail-tracking?${params.toString()}`);
        const payload = (await response.json()) as OverviewResponse | { error: string };
        if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load tracking.");
        if (requestId !== requestIdRef.current) return;
        const data = payload as OverviewResponse;
        setRecipients((prev) => (opts.append ? [...prev, ...data.recipients] : data.recipients));
        setTotal(data.total ?? data.totals.recipients);
        setTotals(data.totals);
        setTruncated(Boolean(data.totals.truncated));
        setUpdatedAt(Date.now());
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError((err as Error).message || "Failed to load tracking.");
      } finally {
        if (requestId !== requestIdRef.current) return;
        if (opts.append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [],
  );

  const fetchSearch = useCallback(async (query: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query });
      const response = await fetch(`/api/admin/mail-tracking?${params.toString()}`);
      const payload = (await response.json()) as OverviewResponse | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load tracking.");
      if (requestId !== requestIdRef.current) return;
      const data = payload as OverviewResponse;
      setRecipients(data.recipients);
      setTotal(data.totals.recipients);
      setTotals(data.totals);
      setTruncated(Boolean(data.totals.truncated));
      setUpdatedAt(Date.now());
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError((err as Error).message || "Failed to load tracking.");
    } finally {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = search.trim();
    const handle = setTimeout(() => {
      if (trimmed.length > 0) void fetchSearch(trimmed);
      else void fetchRecent({ offset: 0, limit: RECIPIENTS_PAGE_SIZE, append: false });
    }, trimmed.length > 0 ? 300 : 0);
    return () => clearTimeout(handle);
  }, [fetchRecent, fetchSearch, search]);

  const isSearchMode = search.trim().length > 0;
  const hasMore = !isSearchMode && recipients.length < total;
  const csvUrl = isSearchMode
    ? `/api/admin/mail-tracking?q=${encodeURIComponent(search.trim())}&format=csv`
    : `/api/admin/mail-tracking?mode=recent&limit=100&format=csv`;

  const loadSendDetail = useCallback(async (sendId: string) => {
    setDetailBySend((prev) => ({ ...prev, [sendId]: "loading" }));
    try {
      const response = await fetch(`/api/admin/mail-tracking/${encodeURIComponent(sendId)}`);
      const payload = (await response.json()) as SendDetailResponse | { error: string };
      if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load detail.");
      setDetailBySend((prev) => ({ ...prev, [sendId]: payload as SendDetailResponse }));
    } catch (err) {
      setDetailBySend((prev) => ({ ...prev, [sendId]: { error: (err as Error).message || "Failed to load." } }));
    }
  }, []);

  const toggleRecipient = useCallback(
    (key: string, sendIds: string[]) => {
      setExpanded((prev) => (prev === key ? null : key));
      sendIds.forEach((id) => {
        if (!detailBySend[id]) void loadSendDetail(id);
      });
    },
    [detailBySend, loadSendDetail],
  );

  const deleteSend = useCallback(
    async (sendId: string) => {
      const response = await fetch(`/api/admin/mail-tracking/${encodeURIComponent(sendId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to delete mail generation.");
      // Drop the cached detail and refresh, keeping the same number of rows loaded.
      setDetailBySend((prev) => {
        const next = { ...prev };
        delete next[sendId];
        return next;
      });
      const trimmed = search.trim();
      if (trimmed.length > 0) await fetchSearch(trimmed);
      else
        await fetchRecent({
          offset: 0,
          limit: Math.max(RECIPIENTS_PAGE_SIZE, loadedCountRef.current),
          append: false,
        });
    },
    [fetchRecent, fetchSearch, search],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search recipient, company or email (all time)"
            className="w-full rounded-lg border border-glass/15 bg-panel/60 px-3 py-1.5 text-xs text-ink placeholder:text-ink-5 focus:border-amber-300/40 focus:outline-none"
          />
        </div>
        <ButtonLink variant="glass-quiet" size="sm" disabled={recipients.length === 0} href={csvUrl}>
          Export CSV
        </ButtonLink>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-ink-4">
          {isSearchMode
            ? `All-time search · ${total} recipient${total === 1 ? "" : "s"} matching "${search.trim()}"`
            : `Latest recipients · showing ${recipients.length} of ${total}`}
        </p>
        <FreshnessPill updatedAt={updatedAt} loading={loading} />
      </div>

      {error ? <Notice>{error}</Notice> : null}

      {truncated ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-warn">
          {isSearchMode
            ? "Showing the most recent matches. Refine the search to narrow further."
            : "Older sends beyond the scan limit aren't paginated. Use search to find a specific recipient."}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Mails sent"
          value={totals?.mails_sent ?? 0}
          hint={isSearchMode ? "Matching search" : "All time"}
          info="Number of Gmail drafts tracked in the current scope."
        />
        <StatTile
          label="Recipients"
          value={totals?.recipients ?? 0}
          hint="Distinct"
          info="Distinct recipients, counted by lowercased name + company so capitalisation doesn't split entries."
        />
        <StatTile
          label="Real clicks"
          value={totals?.real_clicks ?? 0}
          hint="Humans"
          info="Clicks that did not match the scanner heuristic. These are most likely real recipients opening the link."
        />
        <StatTile
          label="Scanner clicks"
          value={totals?.bot_clicks ?? 0}
          hint="Bots"
          info="Likely corporate link scanners: Outlook ATP, Mimecast, Proofpoint, etc. Hidden unless Scanners is on."
        />
      </div>

      {/* Mobile: stacked cards (below md). */}
      <div className="space-y-2 md:hidden">
        {loading && recipients.length === 0 ? (
          <p className="rounded-xl border border-glass/10 bg-glass/5 px-3 py-6 text-center text-sm text-ink-3/80">
            Loading tracking…
          </p>
        ) : recipients.length === 0 ? (
          <p className="rounded-xl border border-glass/10 bg-glass/5 px-3 py-6 text-center text-sm text-ink-3/80">
            {isSearchMode
              ? "No tracked emails match this search across the full history."
              : "No tracked emails yet. Tracking activates when a Gmail draft is created from the generator."}
          </p>
        ) : (
          recipients.map((recipient) => (
            <RecipientCard
              key={recipient.key}
              recipient={recipient}
              isOpen={expanded === recipient.key}
              onToggle={() => toggleRecipient(recipient.key, recipient.send_ids)}
              showBots={showBots}
              detailBySend={detailBySend}
              onDeleteSend={deleteSend}
            />
          ))
        )}
      </div>

      {/* Desktop: full table (md and up). */}
      <div className="hidden overflow-x-auto rounded-xl border border-glass/10 bg-glass/5 md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-glass/5 text-xs uppercase tracking-wider text-ink-3/80">
            <tr>
              <th className="px-3 py-2">Recipient</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2 text-right">Mails</th>
              <th className="px-3 py-2 text-right">Clicks</th>
              <th className="px-3 py-2 text-right">Last click</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && recipients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-3/80">
                  Loading tracking…
                </td>
              </tr>
            ) : recipients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-3/80">
                  {isSearchMode
                    ? "No tracked emails match this search across the full history."
                    : "No tracked emails yet. Tracking activates when a Gmail draft is created from the generator."}
                </td>
              </tr>
            ) : (
              recipients.map((recipient) => (
                <RecipientRow
                  key={recipient.key}
                  recipient={recipient}
                  isOpen={expanded === recipient.key}
                  onToggle={() => toggleRecipient(recipient.key, recipient.send_ids)}
                  showBots={showBots}
                  detailBySend={detailBySend}
                  onDeleteSend={deleteSend}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() =>
              void fetchRecent({ offset: recipients.length, limit: RECIPIENTS_PAGE_SIZE, append: true })
            }
            disabled={loadingMore}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-glass/15 bg-glass/5 px-4 py-2 text-xs text-ink-2 transition hover:bg-glass/10 disabled:opacity-60"
          >
            {loadingMore
              ? "Loading…"
              : `+${Math.min(RECIPIENTS_PAGE_SIZE, total - recipients.length)} older`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function RecipientRow({
  recipient,
  isOpen,
  onToggle,
  showBots,
  detailBySend,
  onDeleteSend,
}: {
  recipient: Recipient;
  isOpen: boolean;
  onToggle: () => void;
  showBots: boolean;
  detailBySend: Record<string, SendDetailResponse | "loading" | { error: string }>;
  onDeleteSend: (sendId: string) => Promise<void>;
}) {
  const visibleClicks = showBots
    ? recipient.real_clicks + recipient.bot_clicks
    : recipient.real_clicks;
  const botSuffix = showBots ? "" : recipient.bot_clicks > 0 ? ` +${recipient.bot_clicks} scanner` : "";

  return (
    <>
      <tr className="border-t border-glass/5 align-middle">
        <td className="px-3 py-2">
          <div className="flex flex-col">
            <span className="text-sm text-ink">{recipient.recipient_name}</span>
            <span className="text-[11px] text-ink-4">
              {recipient.unique_senders > 1 ? `${recipient.unique_senders} senders` : "1 sender"}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-ink-3">{recipient.company_name ?? "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{recipient.sends_count}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          <span className={visibleClicks > 0 ? "text-warn" : "text-ink-4"}>
            {visibleClicks}
          </span>
          {botSuffix ? <span className="text-[11px] text-ink-5">{botSuffix}</span> : null}
        </td>
        <td className="px-3 py-2 text-right text-xs text-ink-3" title={fmtAbsolute(recipient.last_click_at)}>
          {fmtRelative(recipient.last_click_at)}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg border border-glass/20 bg-glass/10 px-2 py-1 text-xs hover:bg-glass/15"
            aria-expanded={isOpen}
          >
            {isOpen ? "Hide" : "View sends"}
          </button>
        </td>
      </tr>
      {isOpen ? (
        <tr className="border-t border-glass/5 bg-overlay/40">
          <td colSpan={6} className="px-3 py-3">
            <SendDetailsList
              recipient={recipient}
              detailBySend={detailBySend}
              showBots={showBots}
              onDeleteSend={onDeleteSend}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Compact card mirror of RecipientRow used on narrow (below md) viewports. */
function RecipientCard({
  recipient,
  isOpen,
  onToggle,
  showBots,
  detailBySend,
  onDeleteSend,
}: {
  recipient: Recipient;
  isOpen: boolean;
  onToggle: () => void;
  showBots: boolean;
  detailBySend: Record<string, SendDetailResponse | "loading" | { error: string }>;
  onDeleteSend: (sendId: string) => Promise<void>;
}) {
  const visibleClicks = showBots
    ? recipient.real_clicks + recipient.bot_clicks
    : recipient.real_clicks;
  const botSuffix = showBots ? "" : recipient.bot_clicks > 0 ? ` +${recipient.bot_clicks} scanner` : "";

  return (
    <div className="rounded-xl border border-glass/10 bg-glass/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{recipient.recipient_name}</p>
          <p className="truncate text-[11px] text-ink-4">
            {recipient.company_name ?? "—"} ·{" "}
            {recipient.unique_senders > 1 ? `${recipient.unique_senders} senders` : "1 sender"}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="shrink-0 rounded-lg border border-glass/20 bg-glass/10 px-2 py-1 text-xs hover:bg-glass/15"
        >
          {isOpen ? "Hide" : "View sends"}
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-glass/10 bg-glass/[0.04] px-2 py-1.5">
          <dt className="text-[11px] text-ink-4">Mails</dt>
          <dd className="text-xs tabular-nums text-ink">{recipient.sends_count}</dd>
        </div>
        <div className="rounded-lg border border-glass/10 bg-glass/[0.04] px-2 py-1.5">
          <dt className="text-[11px] text-ink-4">Clicks</dt>
          <dd className="text-xs tabular-nums">
            <span className={visibleClicks > 0 ? "text-warn" : "text-ink-4"}>{visibleClicks}</span>
            {botSuffix ? <span className="text-[11px] text-ink-5">{botSuffix}</span> : null}
          </dd>
        </div>
        <div className="rounded-lg border border-glass/10 bg-glass/[0.04] px-2 py-1.5">
          <dt className="text-[11px] text-ink-4">Last click</dt>
          <dd className="text-[11px] text-ink-3" title={fmtAbsolute(recipient.last_click_at)}>
            {fmtRelative(recipient.last_click_at)}
          </dd>
        </div>
      </dl>
      {isOpen ? (
        <div className="mt-3 border-t border-glass/10 pt-3">
          <SendDetailsList
            recipient={recipient}
            detailBySend={detailBySend}
            showBots={showBots}
            onDeleteSend={onDeleteSend}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The expanded per-send detail list, shared by the desktop row and mobile card. */
function SendDetailsList({
  recipient,
  detailBySend,
  showBots,
  onDeleteSend,
}: {
  recipient: Recipient;
  detailBySend: Record<string, SendDetailResponse | "loading" | { error: string }>;
  showBots: boolean;
  onDeleteSend: (sendId: string) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {recipient.send_ids.map((sendId) => {
        const detail = detailBySend[sendId];
        if (!detail) return null;
        if (detail === "loading") {
          return (
            <div key={sendId} className="text-xs text-ink-4">
              Loading send…
            </div>
          );
        }
        if ("error" in detail) {
          return (
            <div
              key={sendId}
              className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-danger"
            >
              {detail.error}
            </div>
          );
        }
        return (
          <SendDetailBlock
            key={sendId}
            detail={detail}
            showBots={showBots}
            onDeleteSend={onDeleteSend}
          />
        );
      })}
    </div>
  );
}

function SendDetailBlock({
  detail,
  showBots,
  onDeleteSend,
}: {
  detail: SendDetailResponse;
  showBots: boolean;
  onDeleteSend: (sendId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteSend(detail.send.id);
      // On success this block unmounts as the list refreshes; no further state.
    } catch (err) {
      setDeleteError((err as Error).message || "Failed to delete.");
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-xl border border-glass/10 bg-glass/5 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{detail.send.subject}</p>
          <p className="text-[11px] text-ink-4">
            {detail.send.mail_type}
            {detail.send.language ? ` · ${detail.send.language}` : ""}
            {detail.send.template_variant ? ` · ${detail.send.template_variant}` : ""}
            {detail.send.training_type ? ` · ${detail.send.training_type}` : ""}
            {detail.send.recipient_email ? ` · ${detail.send.recipient_email}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-ink-3/80" title={fmtAbsolute(detail.send.created_at)}>
            {fmtRelative(detail.send.created_at)}
          </span>
          {confirming ? (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded border border-rose-400/40 bg-rose-500/20 px-2 py-1 text-[11px] font-medium text-danger hover:bg-rose-500/30 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded border border-glass/15 bg-glass/5 px-2 py-1 text-[11px] text-ink-3 hover:bg-glass/10 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded border border-glass/15 bg-glass/5 px-2 py-1 text-[11px] text-ink-4 hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-danger"
              title="Delete this mail generation and its tracking data"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {confirming && !deleting ? (
        <p className="mt-2 text-[11px] text-danger/80">
          This permanently removes this mail generation and all of its click tracking. This cannot be undone.
        </p>
      ) : null}
      {deleteError ? (
        <p className="mt-2 rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[11px] text-danger">
          {deleteError}
        </p>
      ) : null}
      <ClickedLinksList links={detail.links} showBots={showBots} />
    </div>
  );
}

function ClickedLinksList({ links, showBots }: { links: SendDetailLink[]; showBots: boolean }) {
  const [expandedLinkIds, setExpandedLinkIds] = useState<Set<string>>(new Set());
  const clicked = links.filter((link) =>
    showBots ? link.real_clicks + link.bot_clicks > 0 : link.real_clicks > 0,
  );

  if (links.length === 0) {
    return <p className="mt-2 text-xs text-ink-4">No tracked links in this email.</p>;
  }
  if (clicked.length === 0) {
    return (
      <p className="mt-2 text-xs text-ink-4">
        No clicks yet on the {links.length} tracked link{links.length === 1 ? "" : "s"} in this email.
      </p>
    );
  }

  const toggle = (id: string) => {
    setExpandedLinkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ul className="mt-2 space-y-1">
      {clicked.map((link) => {
        const total = showBots ? link.real_clicks + link.bot_clicks : link.real_clicks;
        const botSuffix = showBots || link.bot_clicks === 0 ? "" : ` +${link.bot_clicks} scanner`;
        const visibleClicks = (link.clicks ?? []).filter((click) => showBots || !click.is_likely_bot);
        const isExpanded = expandedLinkIds.has(link.id);
        return (
          <li
            key={link.id}
            className="rounded-lg border border-glass/5 bg-overlay/40"
          >
            <div className="flex items-center justify-between gap-3 px-3 py-1.5">
              <a
                href={link.original_url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-ink-2 hover:text-warn"
                title={link.original_url}
              >
                <span className="font-medium">
                  {link.link_label || link.link_key || pickTrustedHost(link.original_url)}
                </span>
                <span className="ml-2 text-[11px] text-ink-5">{pickTrustedHost(link.original_url)}</span>
              </a>
              <span className="shrink-0 text-right text-xs tabular-nums">
                <span className="text-warn">{total}</span>
                {botSuffix ? <span className="text-[11px] text-ink-5">{botSuffix}</span> : null}
              </span>
              <span
                className="shrink-0 text-[11px] text-ink-4"
                title={fmtAbsolute(link.last_click_at)}
              >
                {fmtRelative(link.last_click_at)}
              </span>
              {visibleClicks.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggle(link.id)}
                  className="shrink-0 rounded border border-glass/15 bg-glass/5 px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-glass/10"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "Hide timeline" : `Show ${visibleClicks.length} click${visibleClicks.length === 1 ? "" : "s"}`}
                </button>
              ) : null}
            </div>
            {isExpanded && visibleClicks.length > 0 ? (
              <ClickTimeline clicks={visibleClicks} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ClickTimeline({ clicks }: { clicks: ClickDetail[] }) {
  return (
    <ol className="border-t border-glass/5 px-3 py-2 text-[11px] text-ink-3">
      {clicks.map((click, idx) => (
        <li
          key={`${click.clicked_at}-${idx}`}
          className="flex items-start gap-2 py-0.5"
        >
          <span className="mt-0.5 inline-flex w-12 shrink-0 justify-end text-ink-5 tabular-nums">
            #{idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink tabular-nums" title={fmtAbsolute(click.clicked_at)}>
                {fmtAbsolute(click.clicked_at)}
              </span>
              <span className="text-[11px] text-ink-5">
                ({fmtRelative(click.clicked_at)})
              </span>
              {click.is_likely_bot ? (
                <Badge tone="neutral">scanner</Badge>
              ) : (
                <Badge tone="warn">real click</Badge>
              )}
            </div>
            {click.user_agent ? (
              <p className="mt-0.5 truncate text-[11px] text-ink-5" title={click.user_agent}>
                {click.user_agent}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
