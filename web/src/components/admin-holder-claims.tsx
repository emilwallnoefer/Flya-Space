"use client";

import { Badge, Button, Notice, Select } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FreshnessPill } from "@/components/freshness-pill";
import { fmtRelative } from "@/lib/admin-format";
import { describeClaimedMaterial, type ClaimedMaterial } from "@/lib/fleet-holder-claims";

/**
 * Admin → Holder claims.
 *
 * Fleet material was imported from a spreadsheet whose holder column was free
 * text ("Emil", "Emil Wallnofer", "Wataru", "APAC team"). When those people get
 * an account they claim the name and the material becomes theirs — and claiming
 * is deliberately permissive, because a strict name match would strand exactly
 * the people the flow exists to onboard.
 *
 * This table is the other half of that trade: every claim is listed, the ones
 * that did not look like the claimant are called out, and an admin can move a
 * label to the right account or release it. The material follows either way —
 * see `app/api/admin/fleet-holder-claims/route.ts`.
 */

type Person = { id: string; email: string | null; name: string };

type HolderClaimRow = {
  label: string;
  claimed_label: string;
  holder: Person | null;
  claimed_by: Person | null;
  claimed_at: string | null;
  self_match: boolean;
  reassigned_by: Person | null;
  reassigned_at: string | null;
  material: ClaimedMaterial;
};

type FeedResponse = { claims: HolderClaimRow[]; users: Person[] };

function personLabel(person: Person | null): string {
  if (!person) return "Unknown account";
  return person.email ? `${person.name} (${person.email})` : person.name;
}

async function requestHolderClaims(): Promise<FeedResponse> {
  const response = await fetch("/api/admin/fleet-holder-claims", { cache: "no-store" });
  const payload = (await response.json()) as FeedResponse | { error: string };
  if (!response.ok) {
    throw new Error((payload as { error: string }).error || "Failed to load holder claims.");
  }
  return payload as FeedResponse;
}

export function AdminHolderClaims() {
  const [claims, setClaims] = useState<HolderClaimRow[]>([]);
  const [users, setUsers] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Which label a reassign is being composed for, and the account picked so far.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  // State changes only in the promise callbacks, so the mount effect can start
  // it; `load` adds the synchronous "loading" reset for later reloads.
  const fetchClaims = useCallback(
    () =>
      requestHolderClaims()
        .then(
          (feed) => {
            setClaims(feed.claims);
            setUsers(feed.users);
            setUpdatedAt(Date.now());
          },
          (err: Error) => setError(err.message || "Failed to load holder claims."),
        )
        .finally(() => setLoading(false)),
    [],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetchClaims();
  }, [fetchClaims]);

  useEffect(() => {
    void fetchClaims();
  }, [fetchClaims]);

  const act = useCallback(
    async (body: { action: "reassign"; label: string; user_id: string } | { action: "release"; label: string }) => {
      setBusyLabel(body.label);
      setError(null);
      setMessage(null);
      try {
        const response = await fetch("/api/admin/fleet-holder-claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { message?: string; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not update that claim.");
        setMessage(payload.message ?? "Done.");
        setPending((prev) => {
          const next = { ...prev };
          delete next[body.label];
          return next;
        });
        await load();
      } catch (err) {
        setError((err as Error).message || "Could not update that claim.");
      } finally {
        setBusyLabel(null);
      }
    },
    [load],
  );

  const mismatches = useMemo(() => claims.filter((claim) => !claim.self_match).length, [claims]);

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-ink-4">
          Who claimed which fleet holder name. Claiming is deliberately loose — the material came from a
          spreadsheet that spelled people inconsistently — so a claim that does not look like the claimant is
          flagged here and mailed to admins rather than blocked. Reassign a name to move its material to the
          right account, or release it back to unclaimed.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <FreshnessPill updatedAt={updatedAt} loading={loading} />
          <Button variant="glass-quiet" size="sm" disabled={loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-glass/10 bg-glass/5 px-4 py-3">
        <span className="text-[11px] uppercase tracking-[0.15em] text-ink-5">Claims</span>
        <span className="text-sm text-ink">{claims.length}</span>
        <span className="text-[11px] uppercase tracking-[0.15em] text-ink-5">Name mismatches</span>
        <span className={`text-sm ${mismatches > 0 ? "text-warn" : "text-ink"}`}>{mismatches}</span>
      </div>

      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice tone="positive">{message}</Notice> : null}

      <div className="relative">
        {updatedAt != null ? (
          <span key={`sweep-${updatedAt}`} aria-hidden className="data-refresh-sweep" />
        ) : null}
        <div className="overflow-x-auto rounded-xl border border-glass/10 bg-glass/5">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-glass/5 text-xs uppercase tracking-wider text-ink-3/80">
              <tr>
                <th className="px-3 py-2">Name as typed</th>
                <th className="px-3 py-2">Holder now</th>
                <th className="px-3 py-2">Claimed by</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">Fix</th>
              </tr>
            </thead>
            <tbody>
              {loading && claims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-ink-3/80">
                    Loading holder claims…
                  </td>
                </tr>
              ) : claims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-ink-3/80">
                    Nobody has claimed a holder name yet.
                  </td>
                </tr>
              ) : (
                claims.map((claim) => {
                  const busy = busyLabel === claim.label;
                  const picked = pending[claim.label] ?? "";
                  return (
                    <tr
                      key={claim.label}
                      className={`border-t border-glass/5 align-top ${
                        claim.self_match ? "" : "bg-amber-400/[0.07]"
                      }`}
                    >
                      <td className="px-3 py-2 text-xs text-ink">{claim.claimed_label}</td>
                      <td className="px-3 py-2 text-xs text-ink-2">
                        {personLabel(claim.holder)}
                        {claim.reassigned_by ? (
                          <span className="mt-0.5 block text-[11px] text-ink-5">
                            reassigned by {claim.reassigned_by.email ?? claim.reassigned_by.name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-3">
                        {claim.claimed_by ? personLabel(claim.claimed_by) : "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-xs text-ink-4"
                        title={claim.claimed_at ? new Date(claim.claimed_at).toLocaleString() : undefined}
                      >
                        {fmtRelative(claim.claimed_at)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {claim.self_match ? (
                          <Badge tone="neutral">Matches</Badge>
                        ) : (
                          <Badge tone="warn" title="The label did not look like the claimant's name or email">
                            No match
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-4">
                        {describeClaimedMaterial(claim.material)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* `cn()` has no tailwind-merge, so the width lives on a
                              wrapper rather than fighting the Select's own `w-full`. */}
                          <div className="w-52">
                            <Select
                              aria-label={`Reassign ${claim.claimed_label} to`}
                              value={picked}
                              disabled={busy}
                              onChange={(event) =>
                                setPending((prev) => ({ ...prev, [claim.label]: event.target.value }))
                              }
                            >
                              <option value="">Reassign to…</option>
                              {users
                                .filter((user) => user.id !== claim.holder?.id)
                                .map((user) => (
                                  <option key={user.id} value={user.id}>
                                    {user.email ?? user.name}
                                  </option>
                                ))}
                            </Select>
                          </div>
                          <Button
                            variant="accent-outline"
                            size="xs"
                            disabled={busy || !picked}
                            onClick={() =>
                              void act({ action: "reassign", label: claim.label, user_id: picked })
                            }
                          >
                            {busy ? "Working…" : "Reassign"}
                          </Button>
                          <Button
                            variant="danger"
                            size="xs"
                            disabled={busy}
                            onClick={() => void act({ action: "release", label: claim.label })}
                          >
                            Release
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
