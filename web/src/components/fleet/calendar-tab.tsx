"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { formatDayLong, formatSpan, occupiedUntil, spanLength } from "@/lib/fleet-rules";
import { playUiSound } from "@/lib/ui-sounds";
import { CalendarLegend } from "./calendar-legend";
import { DayGrid, type DaySelection } from "./day-grid";
import { EmptyState, Skeleton } from "./ui";
import { WINDOW_DAYS, type FleetState } from "./use-fleet";
import type { FleetReservation } from "./types";

/**
 * The booking screen: the grid, and what you do with a selection.
 *
 * Only the content. The window navigation and the filters live in
 * `FleetToolbar` with the section tabs, so the panel has one control surface
 * rather than a band of chrome per feature.
 */
export function CalendarTab({
  state,
  onOpenReservation,
  onManage,
}: {
  state: FleetState;
  onOpenReservation: (reservation: FleetReservation) => void;
  /** Admin shortcut out of the empty state. */
  onManage: () => void;
}) {
  const {
    board,
    loading,
    busy,
    post,
    alternatives,
    windowStart,
    // Set in the toolbar, read here: the grid is what it changes.
    showPast,
    today,
    assets,
    reservations,
    bookableAssets,
    visibleHolders,
  } = state;

  const [selection, setSelection] = useState<DaySelection>(null);
  // A booking an admin has asked to remove, held until they confirm.
  const [pendingRemoval, setPendingRemoval] = useState<FleetReservation | null>(null);
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");

  const selectedAsset = selection ? (assets.find((a) => a.id === selection.assetId) ?? null) : null;
  const daysSelected = selection ? spanLength(selection.startDate, selection.endDate) : 0;

  async function confirmBooking(waitlist: boolean, assetId: string = selection?.assetId ?? "") {
    if (!selection || !assetId) return;
    const ok = await post({
      action: "reserve",
      asset_id: assetId,
      start_date: selection.startDate,
      end_date: selection.endDate,
      destination: destination.trim() || undefined,
      purpose: purpose.trim() || undefined,
      waitlist,
    });
    if (ok) {
      playUiSound("switchWhoosh");
      setSelection(null);
      setDestination("");
      setPurpose("");
    }
  }

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------------------- the grid */}
      {loading && !board ? (
        <GridSkeleton />
      ) : bookableAssets.length === 0 ? (
        <EmptyState
          title={assets.length === 0 ? "The fleet is empty" : "Nothing bookable matches this filter"}
          hint={
            assets.length === 0
              ? "Material added in Manage becomes bookable here for everyone."
              : "Only pooled units that are neither retired nor in repair appear in the calendar. Try clearing the filters above."
          }
          action={
            assets.length === 0 && board?.is_admin ? (
              <Button size="xs" variant="accent" onClick={onManage}>
                Add material
              </Button>
            ) : null
          }
        />
      ) : (
        <DayGrid
          assets={bookableAssets}
          reservations={reservations}
          windowStart={windowStart}
          windowDays={WINDOW_DAYS}
          today={today}
          horizonDays={board?.is_admin ? 365 : (board?.me.horizonDays ?? 56)}
          selection={selection}
          showPast={showPast}
          canRemove={board?.is_admin ?? false}
          onSelect={setSelection}
          onOpenReservation={onOpenReservation}
          onRemove={setPendingRemoval}
        />
      )}

      {/* --------------------------------------------- admin removal prompt */}
      {pendingRemoval ? (
        <div
          role="alertdialog"
          aria-label="Confirm removing this booking"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2"
        >
          <p className="text-xs text-ink-2">
            Remove{" "}
            <span className="font-medium text-ink">
              {assets.find((a) => a.id === pendingRemoval.asset_id)?.name ?? "this booking"}
            </span>{" "}
            for {pendingRemoval.is_mine ? "you" : pendingRemoval.holder_name} on{" "}
            {formatSpan(pendingRemoval.start_date, occupiedUntil(pendingRemoval))}? The days go back into the
            pool.
          </p>
          <span className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="danger"
              disabled={busy}
              onClick={() => {
                const target = pendingRemoval;
                setPendingRemoval(null);
                void post({ action: "cancel", reservation_id: target.id });
              }}
            >
              {busy ? "Removing…" : "Remove booking"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setPendingRemoval(null)}>
              Keep
            </Button>
          </span>
        </div>
      ) : null}

      {/* ------------------------------------------------- booking composer */}
      {selection && selectedAsset ? (
        <div className="sticky bottom-0 z-[2] rounded-xl border border-accent/35 bg-panel/95 p-4 shadow-[0_-12px_32px_-16px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">{selectedAsset.name}</p>
              <p className="mt-0.5 text-xs text-ink-3">
                <span className="font-medium text-accent-soft">
                  {daysSelected} day{daysSelected === 1 ? "" : "s"}
                </span>{" "}
                · {formatSpan(selection.startDate, selection.endDate)} · back by{" "}
                {formatDayLong(selection.endDate)}
              </p>
              <p className="mt-1 text-[11px] text-ink-5">
                Click another day in the same row to extend, or the same day again to clear.
              </p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setSelection(null)}>
              Clear
            </Button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Where is it going? (site, city, customer)"
              className="text-xs"
              aria-label="Destination"
            />
            <Input
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="What for? (optional)"
              className="text-xs"
              aria-label="Purpose"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="accent" onClick={() => void confirmBooking(false)} disabled={busy}>
              {busy ? "Booking…" : `Book ${daysSelected} day${daysSelected === 1 ? "" : "s"}`}
            </Button>
            <Button size="sm" variant="glass" onClick={() => void confirmBooking(true)} disabled={busy}>
              Join waitlist instead
            </Button>
            {/* Offered by the server with a clash: the same days on a free
                unit of the same kind. One tap books it there instead. */}
            {alternatives.map((alt) => (
              <Button key={alt.asset_id} size="sm" variant="accent" disabled={busy} onClick={() => void confirmBooking(false, alt.asset_id)}>
                Book {alt.name} instead{alt.location ? ` · ${alt.location}` : ""}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <CalendarLegend holders={visibleHolders} />
    </div>
  );
}

/** The shape of the grid, while the first board is still on its way. */
function GridSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-xl border border-glass/10 bg-glass/[0.03] p-2">
      <Skeleton className="h-7 w-full" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-1 py-1">
          <Skeleton className="h-8 w-48 shrink-0" />
          <Skeleton className="h-8 flex-1" />
        </div>
      ))}
    </div>
  );
}
