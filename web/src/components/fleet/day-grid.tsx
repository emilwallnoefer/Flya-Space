"use client";

import { memo, useCallback, useMemo } from "react";
import {
  calendarLayerFor,
  DAY_MS,
  daysBetween,
  describeDays,
  formatDay,
  monthBands,
  occupiedUntil,
  parseDateKey,
  type DayMeta,
} from "@/lib/fleet-rules";
import { AssetIcon } from "./asset-icon";
import { useHolderRgb } from "./holder-colors";
import type { FleetAsset, FleetReservation } from "./types";

/**
 * The booking calendar: one row per asset, one cell per DAY.
 *
 * Clicking a free cell starts a selection; clicking a second cell in the same
 * row extends it — that is the whole booking gesture. Occupied cells show who
 * has the material, so "where is it on the 14th" is answerable at a glance,
 * which the merged-cell spreadsheet grid never managed.
 *
 * Days rather than weeks because most missions are two or three days long.
 * Booking by the week meant a Tuesday–Wednesday job blocked the unit from
 * Monday to Sunday, so the board looked full while the shelf was not.
 *
 * ## Why this file is shaped for re-rendering
 *
 * The grid is the biggest thing on the screen — roughly 400 cells — and it sits
 * under state that changes constantly: a keystroke in the search box, a click in
 * the calendar. Two rules keep that cheap, and both are easy to undo by
 * accident:
 *
 *  1. **Per-day facts are computed once per window**, by `describeDays`, not per
 *     cell. Anything that depends only on the day belongs in `DayMeta`.
 *  2. **Each row is a memoised component** that only sees its own slice of the
 *     selection, so selecting days in one row does not re-render the others.
 *     This works only while the callbacks from the parent are stable — they are
 *     `useState` setters today. Passing an inline arrow instead would silently
 *     make every row re-render again.
 */

export type DaySelection = { assetId: string; startDate: string; endDate: string } | null;

type DayGridProps = {
  assets: FleetAsset[];
  reservations: FleetReservation[];
  windowStart: string;
  windowDays: number;
  today: string;
  /** Days ahead the viewer is allowed to book, from their reliability score. */
  horizonDays: number;
  selection: DaySelection;
  /**
   * Whether finished bookings are drawn behind the live ones.
   *
   * Only ever hides COMPLETED bookings. A booking that still holds the asset
   * stays on the grid whatever this is set to — hiding one would draw a booked
   * unit as free, which is the one thing this calendar must never do.
   */
  showPast: boolean;
  /**
   * Whether to offer the per-cell remove control. Admin only — the server is
   * the authority (`cancel` already refuses anyone but the owner or an admin);
   * this just decides whether to draw it.
   */
  canRemove: boolean;
  onSelect: (selection: DaySelection) => void;
  onOpenReservation: (reservation: FleetReservation) => void;
  /** Asks to remove a booking. The caller confirms; this only requests it. */
  onRemove: (reservation: FleetReservation) => void;
};

type CellState = {
  reservation: FleetReservation | null;
  /** True when `reservation` is a completed booking rather than a live one. */
  isHistory: boolean;
  /** First cell of a visible run, so one label is drawn per booking. */
  isRunStart: boolean;
  bookable: boolean;
  beyondHorizon: boolean;
  inPast: boolean;
};

/** The part of a selection one row cares about: its own, or nothing. */
type RowSelection = { startDate: string; endDate: string } | null;

export function DayGrid({
  assets,
  reservations,
  windowStart,
  windowDays,
  today,
  horizonDays,
  selection,
  showPast,
  canRemove,
  onSelect,
  onOpenReservation,
  onRemove,
}: DayGridProps) {
  // Every per-day fact the grid needs, in one pass over the window. See the
  // file header — this is the difference between ~400 date parses per render
  // and ~28 per window.
  const days = useMemo(
    () => describeDays({ windowStart, windowDays, today, horizonDays }),
    [windowStart, windowDays, today, horizonDays],
  );

  const months = useMemo(() => monthBands(days), [days]);

  // Index reservations by asset+day once, rather than scanning the list for
  // every one of the (assets × days) cells.
  //
  // Two maps, because a completed booking still belongs on the calendar: "who
  // had this in March" is a question the board should answer, and without it
  // scrolling into the past shows an empty grid however much history exists.
  // Live bookings win a shared day — a returned booking no longer holds the
  // asset, so it must never hide the one that does.
  const { live: byAssetDay, history: historyByAssetDay } = useMemo(() => {
    const live = new Map<string, FleetReservation>();
    const history = new Map<string, FleetReservation>();
    for (const reservation of reservations) {
      const layer = calendarLayerFor(reservation.status, showPast);
      // Cancelled and waitlisted hold nothing; finished bookings drop out here
      // while past bookings are hidden, so they cost no work either.
      if (!layer) continue;
      const target = layer === "live" ? live : history;
      // Stops on the day it actually came back, when that was early.
      const length = daysBetween(reservation.start_date, occupiedUntil(reservation));
      const startMs = parseDateKey(reservation.start_date).getTime();
      for (let i = 0; i <= length; i += 1) {
        const d = new Date(startMs + i * DAY_MS);
        target.set(`${reservation.asset_id}|${d.toISOString().slice(0, 10)}`, reservation);
      }
    }
    return { live, history };
  }, [reservations, showPast]);

  return (
    <div className="overflow-x-auto rounded-xl border border-glass/10 bg-glass/[0.03]">
      {/* `table-fixed` + an explicit colgroup: with the auto layout the browser
          sized each day column to fit whatever sat above it, so the month-band
          headers (colSpan) stretched the days under a short band and squeezed
          the rest. Fixed layout splits the width evenly across every day. */}
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-left"
        style={{ minWidth: `${13 + days.length * 2.1}rem` }}
      >
        <colgroup>
          <col className="w-32 sm:w-52" />
          {days.map((day) => (
            <col key={day.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              scope="col"
              rowSpan={2}
              className="sticky left-0 z-[2] w-32 bg-surface/95 sm:w-52 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3/75 backdrop-blur"
            >
              Material
            </th>
            {months.map((group, i) => (
              <th
                key={`${group.label}-${i}`}
                scope="col"
                colSpan={group.span}
                // Month bands are the only place the year is stated, so they
                // carry the eyebrow treatment the rest of the app uses for
                // "this is a label, not content".
                className="border-b border-glass/[0.07] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.15em] text-ink-3/75"
              >
                {group.label}
              </th>
            ))}
          </tr>
          <tr>
            {days.map((day) => (
              <th
                key={day.key}
                scope="col"
                title={`KW ${day.isoWeek}`}
                // Today gets a tinted column rather than only a coloured
                // numeral: on a board already coloured by person, a hue change
                // on two characters is the one cue that does not survive.
                className={`px-0.5 py-1.5 text-center text-[11px] font-medium ${
                  day.weekBoundary ? "border-l border-glass/20" : ""
                } ${
                  day.isToday
                    ? "bg-accent-deep/25 text-accent-soft"
                    : day.weekend
                      ? "bg-glass/[0.02] text-ink-5/70"
                      : "text-ink-3/75"
                }`}
              >
                <span className="block">{day.weekdayLabel}</span>
                <span className="block text-[11px] font-normal tabular-nums">{day.dayOfMonth}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              days={days}
              byAssetDay={byAssetDay}
              historyByAssetDay={historyByAssetDay}
              rowSelection={
                selection && selection.assetId === asset.id
                  ? { startDate: selection.startDate, endDate: selection.endDate }
                  : null
              }
              canRemove={canRemove}
              onSelect={onSelect}
              onOpenReservation={onOpenReservation}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One asset's row.
 *
 * Memoised on purpose: `rowSelection` is null for every row but the one being
 * selected, so a click in the calendar re-renders one row instead of all of
 * them. `days`, the two index maps and the two callbacks are all referentially
 * stable between renders, so the comparison actually holds.
 */
const AssetRow = memo(function AssetRow({
  asset,
  days,
  byAssetDay,
  historyByAssetDay,
  rowSelection,
  canRemove,
  onSelect,
  onOpenReservation,
  onRemove,
}: {
  asset: FleetAsset;
  days: DayMeta[];
  byAssetDay: Map<string, FleetReservation>;
  historyByAssetDay: Map<string, FleetReservation>;
  rowSelection: RowSelection;
  canRemove: boolean;
  onSelect: (selection: DaySelection) => void;
  onOpenReservation: (reservation: FleetReservation) => void;
  onRemove: (reservation: FleetReservation) => void;
}) {
  // Read from context rather than derived per cell: the guarantee that nobody
  // shares a colour only exists at the level of the whole roster.
  const rgbOf = useHolderRgb();
  const assetBookable = asset.status !== "retired" && asset.status !== "in_repair";

  const stateFor = useCallback(
    (day: DayMeta, index: number): CellState => {
      const key = `${asset.id}|${day.key}`;
      const liveReservation = byAssetDay.get(key) ?? null;
      const reservation = liveReservation ?? historyByAssetDay.get(key) ?? null;
      const isHistory = liveReservation === null && reservation !== null;
      return {
        reservation,
        // Label the booking's own first day, or the window's left edge when the
        // booking started before the visible range.
        isHistory,
        isRunStart: reservation ? reservation.start_date === day.key || index === 0 : false,
        // A finished booking does not hold the asset, so a future day carrying one
        // is still bookable. In practice history sits in the past anyway.
        bookable: !liveReservation && !day.inPast && !day.beyondHorizon && assetBookable,
        beyondHorizon: day.beyondHorizon,
        inPast: day.inPast,
      };
    },
    [asset.id, assetBookable, byAssetDay, historyByAssetDay],
  );

  const handleCellClick = useCallback(
    (day: string, state: CellState) => {
      // A past booking is still worth opening — it answers "who had this, and
      // when did it come back" — but it must not block booking a free future day.
      if (state.reservation && (!state.isHistory || !state.bookable)) {
        onOpenReservation(state.reservation);
        return;
      }
      if (!state.bookable) return;

      // Second click in the same row extends the run; anything else starts fresh.
      if (rowSelection) {
        if (day === rowSelection.startDate && day === rowSelection.endDate) {
          onSelect(null); // click the single selected cell again to clear
          return;
        }
        const startDate = day < rowSelection.startDate ? day : rowSelection.startDate;
        const endDate = day > rowSelection.startDate ? day : rowSelection.startDate;
        onSelect({ assetId: asset.id, startDate, endDate });
        return;
      }
      onSelect({ assetId: asset.id, startDate: day, endDate: day });
    },
    [asset.id, rowSelection, onSelect, onOpenReservation],
  );

  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-[1] border-t border-glass/[0.07] bg-surface/95 px-3 py-2 backdrop-blur"
      >
        <span className="flex items-center gap-1.5">
          <AssetIcon category={asset.category} className="h-4 w-4 shrink-0 text-ink-4" />
          <span className="truncate text-xs font-medium text-ink">{asset.name}</span>
        </span>
        {/* Where it is, under what it is. How long ago that was confirmed is
            deliberately absent here and in the Material register: an admin sets
            a location once in Manage, so an age in days reported on every row
            was chrome about a problem nobody had. */}
        <span className="block truncate pl-[1.375rem] text-[11px] font-normal text-ink-5">
          {asset.current_location ?? "Location unknown"}
        </span>
      </th>
      {days.map((day, index) => {
        const state = stateFor(day, index);
        const selected =
          rowSelection != null && day.key >= rowSelection.startDate && day.key <= rowSelection.endDate;
        const reservation = state.reservation;
        const overdue = reservation != null && reservation.days_overdue > 0;

        return (
          <td
            key={day.key}
            // The column tints live on the cell rather than the button so they
            // run behind a booking too — that is what makes "today" and the
            // weekends readable as continuous columns down the whole board.
            className={`group/cell relative border-t border-glass/[0.07] p-px ${
              day.weekBoundary ? "border-l border-l-glass/20" : ""
            } ${day.isToday ? "bg-accent-deep/15" : day.weekend ? "bg-glass/[0.02]" : ""}`}
          >
            <button
              type="button"
              onClick={() => handleCellClick(day.key, state)}
              disabled={!state.bookable && !reservation}
              title={
                reservation
                  ? `${asset.name} · ${formatDay(day.key)} · ${reservation.holder_name}${
                      state.isHistory ? " (returned)" : ""
                    }${reservation.unclaimed ? " (from the sheet — not claimed yet)" : ""}${
                      reservation.destination ? ` · ${reservation.destination}` : ""
                    }`
                  : `${asset.name} · ${formatDay(day.key)}`
              }
              aria-label={
                reservation
                  ? `${asset.name}, ${formatDay(day.key)}: ${
                      state.isHistory ? "was with" : "booked by"
                    } ${reservation.holder_name}`
                  : `${asset.name}, ${formatDay(day.key)}: ${
                      state.bookable ? "free, click to book" : "not bookable"
                    }`
              }
              aria-pressed={selected}
              className={cellClass({
                state,
                selected,
                overdue,
                mine: reservation?.is_mine ?? false,
                unclaimed: reservation?.unclaimed ?? false,
                isHistory: state.isHistory,
                isToday: day.isToday,
              })}
              style={
                reservation && !selected
                  ? cellStyle({
                      rgb: rgbOf(reservation.holder_name),
                      isHistory: state.isHistory,
                      unclaimed: reservation.unclaimed,
                      overdue,
                    })
                  : undefined
              }
            >
              {reservation && state.isRunStart ? (
                <span className="pointer-events-none absolute left-0.5 z-[1] whitespace-nowrap text-[10px] font-medium">
                  {reservation.is_mine ? "You" : firstNameOf(reservation.holder_name)}
                </span>
              ) : null}
            </button>
            {canRemove && reservation && reservation.status === "reserved" ? (
              <button
                type="button"
                onClick={() => onRemove(reservation)}
                title={`Remove ${asset.name} booking — ${reservation.holder_name}`}
                aria-label={`Remove booking: ${asset.name}, ${reservation.holder_name}, ${formatDay(
                  reservation.start_date,
                )}`}
                className="fleet-remove absolute right-0 top-0 z-[3] flex h-3.5 w-3.5 items-center justify-center rounded-bl-[3px] rounded-tr-[3px] bg-slate-900/80 text-[11px] leading-none text-rose-200 opacity-0 transition hover:bg-rose-500 hover:text-white focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover/cell:opacity-100"
              >
                −
              </button>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
});

/**
 * The colour of a booked cell: the hue is the person, the weight is the state.
 *
 * Keeping those on separate channels is the point — a month of finished
 * bookings should read as the same people, faded, rather than as a different
 * category of thing. Unclaimed bookings get a hatch on top of the hue, so
 * "nobody is accountable for this" survives being the same colour as its owner.
 */
function cellStyle(args: {
  /** Already resolved by the caller: colours are allocated per board, not per name. */
  rgb: string;
  isHistory: boolean;
  unclaimed: boolean;
  overdue: boolean;
}): React.CSSProperties {
  const { rgb, isHistory, unclaimed, overdue } = args;
  const alpha = isHistory ? 0.2 : overdue ? 0.75 : 0.55;
  const style: React.CSSProperties = {
    backgroundColor: `rgb(${rgb} / ${alpha})`,
    color: isHistory ? `rgb(${rgb} / 0.95)` : "rgb(15 23 42)",
  };
  if (unclaimed) {
    style.backgroundImage =
      `repeating-linear-gradient(45deg, transparent, transparent 3px, rgb(255 255 255 / 0.22) 3px, rgb(255 255 255 / 0.22) 5px)`;
  }
  return style;
}

function cellClass(args: {
  state: CellState;
  selected: boolean;
  overdue: boolean;
  mine: boolean;
  unclaimed: boolean;
  isHistory: boolean;
  isToday: boolean;
}): string {
  const { state, selected, overdue, mine, isToday } = args;
  // `relative` so a run's name label can overflow its own day cell.
  // `touch-manipulation`: the grid is tapped repeatedly to build a span, and
  // without it every tap pays the browser's 300ms double-tap-to-zoom wait.
  // `fleet-day` is a hook for the appearance skins (it carries no styles): the
  // cell's colour is information, so the skins must not restyle it as a menu item.
  const base =
    "fleet-day relative flex h-8 w-full touch-manipulation items-center justify-center overflow-visible rounded-[3px] text-ink transition ease-fluid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent/80";
  const todayRing = isToday ? " ring-1 ring-inset ring-accent/50" : "";

  if (selected) return `${base}${todayRing} bg-accent/85 text-slate-900`;
  // A booked cell's colour identifies the PERSON and comes from cellStyle();
  // the class only carries the shell, the hover lift and the state outlines, so
  // hue answers "whose is it" and outline answers "what state is it in".
  if (state.reservation) {
    const ring = overdue
      ? " outline outline-2 -outline-offset-2 outline-rose-400/90"
      : mine
        ? " outline outline-1 -outline-offset-1 outline-glass/60"
        : "";
    return `${base}${todayRing}${ring} font-medium hover:brightness-125`;
  }
  if (state.inPast) return `${base}${todayRing} cursor-default bg-transparent opacity-25`;
  if (state.beyondHorizon) {
    return `${base}${todayRing} cursor-not-allowed bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,0.05)_3px,rgba(255,255,255,0.05)_6px)]`;
  }
  if (!state.bookable) return `${base}${todayRing} cursor-not-allowed bg-transparent opacity-20`;
  // Free cells are one weight everywhere: the weekend and today tints belong to
  // the column (on the <td>), so they run behind booked cells too.
  return `${base}${todayRing} bg-glass/[0.07] hover:bg-accent/30`;
}

function firstNameOf(name: string): string {
  return name.split(" ")[0] ?? name;
}
