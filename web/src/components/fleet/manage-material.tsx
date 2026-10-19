"use client";

import { useMemo, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { useHolderRgb } from "./holder-colors";
import { AssetDialog, type AssetDraft } from "./asset-dialog";
import { AssetIcon } from "./asset-icon";
import { EmptyState, SectionHeading } from "./ui";
import {
  CATEGORY_LABEL,
  categoryRank,
  STATUS_LABEL,
  type FleetArchivedAsset,
  type FleetAsset,
  type FleetAssetCategory,
} from "./types";

/**
 * Admin-only fleet configuration: add material, edit it, remove it.
 *
 * Removal is soft — the unit leaves the calendar and every list, but its rows,
 * its movement history and its bookings survive, and it can be restored from
 * the same screen. A hard delete would cascade the history away, and "this left
 * the fleet" is not "this never existed".
 *
 * The screen is a list plus a dialog. It used to be a stack of six unrelated
 * things in one scroll — a reminders toggle, an add form that pushed everything
 * down when opened, the list with a second edit form expanding inside it, then
 * unclaimed names, standings and the archive — so the thing you came to do was
 * never where you left it. Everything that is not the fleet list now folds
 * away, and adding and editing both happen in `AssetDialog`.
 */

export function ManageMaterial({
  assets,
  archived,
  unclaimed,
  people,
  busy,
  onCreate,
  onUpdate,
  onArchive,
  remindersEnabled,
  onSetReminders,
  standings,
}: {
  assets: FleetAsset[];
  archived: FleetArchivedAsset[];
  /** Holder names from the old sheet that nobody has claimed yet. */
  unclaimed: Array<{ label: string; count: number; live: number }>;
  /** Everyone the fleet knows about, for the "assigned to" picker. */
  people: readonly string[];
  busy: boolean;
  onCreate: (draft: AssetDraft) => Promise<boolean>;
  onUpdate: (assetId: string, draft: AssetDraft) => Promise<boolean>;
  onArchive: (assetId: string, archivedFlag: boolean) => void;
  /** Whether return reminders are being sent at all. */
  remindersEnabled: boolean;
  onSetReminders: (enabled: boolean) => void;
  /** The reliability leaderboard, rendered here so it stays an admin view. */
  standings: React.ReactNode;
}) {
  /** `null` = closed; `{ asset: null }` = adding; `{ asset }` = editing. */
  const [dialog, setDialog] = useState<{ asset: FleetAsset | null } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const map = new Map<FleetAssetCategory, FleetAsset[]>();
    for (const a of assets) {
      if (
        needle &&
        ![a.name, a.serial_number, a.model, a.current_holder_label, a.current_location]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(needle))
      ) {
        continue;
      }
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return [...map.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]));
  }, [assets, search]);

  // The answers the pickers offer, taken from what the fleet already says.
  // Sorted, so the same option sits in the same place every time the dialog
  // opens rather than moving with whatever was added last.
  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      if (a.current_location) set.add(a.current_location);
      if (a.home_location) set.add(a.home_location);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const ownerGroups = useMemo(
    () => [...new Set(assets.map((a) => a.owner_group).filter(Boolean) as string[])].sort(),
    [assets],
  );

  const models = useMemo(
    () => [...new Set(assets.map((a) => a.model).filter(Boolean) as string[])].sort(),
    [assets],
  );

  return (
    <div className="space-y-3">
      {/* ----------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="accent" onClick={() => setDialog({ asset: null })}>
          + Add material
        </Button>
        <div className="w-48 min-w-0 sm:w-64">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
            placeholder="Search the fleet…"
            className="px-2 py-1.5 text-xs"
            aria-label="Search material"
          />
        </div>
        <span className="text-[11px] text-ink-5">{assets.length} active</span>
      </div>

      {/* -------------------------------------------------------------- list */}
      {grouped.length === 0 ? (
        <EmptyState
          title={assets.length === 0 ? "No material yet" : "Nothing matches that search"}
          hint={
            assets.length === 0
              ? "Add the fleet here — everything you add becomes bookable in the calendar for everyone."
              : "Try a different name, serial, model or location."
          }
          action={
            assets.length === 0 ? (
              <Button size="xs" variant="accent" onClick={() => setDialog({ asset: null })}>
                Add the first unit
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, list]) => (
            <section key={category} className="space-y-1.5">
              <SectionHeading
                icon={<AssetIcon category={category} className="h-3.5 w-3.5 shrink-0" />}
                count={list.length}
              >
                {CATEGORY_LABEL[category]}
              </SectionHeading>

              <ul className="space-y-1">
                {list.map((asset) => (
                  <li key={asset.id}>
                    <AssetRow
                      asset={asset}
                      busy={busy}
                      confirming={confirmId === asset.id}
                      onEdit={() => setDialog({ asset })}
                      onAskRemove={() => setConfirmId(asset.id)}
                      onCancelRemove={() => setConfirmId(null)}
                      onRemove={() => {
                        onArchive(asset.id, true);
                        setConfirmId(null);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* --------------------------------------------------- folded sections */}
      <Fold
        title="Return reminders"
        summary={remindersEnabled ? "On" : "Paused"}
        tone={remindersEnabled ? "neutral" : "warn"}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] leading-relaxed text-ink-5">
            {remindersEnabled
              ? "Holders are emailed the day before material is due, on the day, and while it is overdue."
              : "Nothing is emailed. Turn this on once the fleet and its bookings are trusted."}
          </p>
          <Button
            size="xs"
            variant={remindersEnabled ? "glass-quiet" : "accent"}
            disabled={busy}
            onClick={() => onSetReminders(!remindersEnabled)}
          >
            {remindersEnabled ? "Pause reminders" : "Turn reminders on"}
          </Button>
        </div>
      </Fold>

      {unclaimed.length > 0 ? (
        <Fold title="Unclaimed names" summary={String(unclaimed.length)} tone="warn">
          <p className="text-[11px] leading-relaxed text-ink-5">
            Material from the old sheet is filed under these names, and nobody has taken them yet. Until someone
            does, that material has no owner to remind and no score to move. Each person is offered their name
            once, when they first open Fleet.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {unclaimed.map((h) => (
              <li
                key={h.label}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-warn"
              >
                <span className="font-medium">{h.label}</span>
                <span className="opacity-75">
                  {h.live > 0 ? `${h.live} out now · ` : ""}
                  {h.count} total
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      ) : null}

      <Fold title="Reliability standings">{standings}</Fold>

      {archived.length > 0 ? (
        <Fold title="Removed from the fleet" summary={String(archived.length)}>
          <Notice tone="neutral" className="text-xs">
            Removed units keep their bookings and movement history. Restoring one puts it straight back in the
            calendar.
          </Notice>
          <ul className="mt-2 space-y-1">
            {archived.map((asset) => (
              <li
                key={asset.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-glass/10 bg-glass/[0.02] px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <AssetIcon category={asset.category} className="h-4 w-4 shrink-0 text-ink-5" />
                  <span className="truncate text-xs text-ink-3">{asset.name}</span>
                  <span className="truncate text-[11px] text-ink-5">
                    {asset.serial_number ?? asset.model ?? CATEGORY_LABEL[asset.category]}
                  </span>
                </span>
                <Button size="xs" variant="glass-quiet" disabled={busy} onClick={() => onArchive(asset.id, false)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Fold>
      ) : null}

      {dialog ? (
        <AssetDialog
          asset={dialog.asset}
          people={people}
          locations={locations}
          ownerGroups={ownerGroups}
          models={models}
          busy={busy}
          onSave={(draft) => (dialog.asset ? onUpdate(dialog.asset.id, draft) : onCreate(draft))}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One unit in the admin list.
 *
 * Denser than the Material register's tile — this is a list you scan to find
 * the one you need to change, not a board you read — but it carries the same
 * holder colour, so the two screens agree about who has what.
 */
function AssetRow({
  asset,
  busy,
  confirming,
  onEdit,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  asset: FleetAsset;
  busy: boolean;
  confirming: boolean;
  onEdit: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const rgbOf = useHolderRgb();
  const holder = asset.current_holder_label ?? asset.holder_name;
  const rgb = holder ? rgbOf(holder) : null;

  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-glass/10 bg-glass/[0.04] transition ease-fluid hover:border-glass/20 hover:bg-glass/[0.06]">
      <span
        aria-hidden
        className="h-full w-1 shrink-0 self-stretch"
        style={{ backgroundColor: rgb ? `rgb(${rgb} / 0.85)` : "rgb(148 163 184 / 0.25)" }}
      />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-2">
        <AssetIcon category={asset.category} className="h-4 w-4 shrink-0 text-ink-4" />
        <span className="truncate text-xs font-medium text-ink">{asset.name}</span>
        <span className="truncate text-[11px] text-ink-5">
          {[asset.model, asset.serial_number].filter(Boolean).join(" · ")}
        </span>
        <span className="flex-1" />
        {/* Assigned units carry no location — see the Material register for
            why: it travels with its person and would be wrong by morning. */}
        {asset.pooled ? (
          <span className="truncate text-[11px] text-ink-5">
            {asset.current_location ?? "Location unknown"}
          </span>
        ) : null}
        <span className="text-[11px] text-ink-4">
          {asset.pooled ? STATUS_LABEL[asset.status] : (holder ?? "Assigned to nobody")}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2">
        {confirming ? (
          <>
            <Button size="xs" variant="danger" disabled={busy} onClick={onRemove}>
              Remove
            </Button>
            <Button size="xs" variant="ghost" onClick={onCancelRemove}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button size="xs" variant="glass-quiet" disabled={busy} onClick={onEdit}>
              Edit
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={onAskRemove}>
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A section that stays out of the way until asked for.
 *
 * Everything below the fleet list is reference — reminders you set once, names
 * waiting to be claimed, a leaderboard, an archive. Open by default they turned
 * Manage into a page you scroll past; the summary in the header is enough to
 * tell you whether it is worth opening.
 */
function Fold({
  title,
  summary,
  tone = "neutral",
  children,
}: {
  title: string;
  summary?: string;
  tone?: "neutral" | "warn";
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-glass/10 bg-glass/[0.03]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/80">
        <span className="text-ink-5 transition ease-fluid group-open:rotate-90" aria-hidden>
          ›
        </span>
        <span className="text-[11px] uppercase tracking-[0.15em] text-ink-3/75">{title}</span>
        {summary ? (
          <span
            className={`rounded px-1.5 py-px text-[11px] ${
              tone === "warn" ? "bg-amber-500/15 text-warn" : "bg-glass/10 text-ink-5"
            }`}
          >
            {summary}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-glass/[0.07] px-3 py-2.5">{children}</div>
    </details>
  );
}
