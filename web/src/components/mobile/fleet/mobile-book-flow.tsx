"use client";

import { useMemo, useState } from "react";
import { AssetIcon } from "@/components/fleet/asset-icon";
import { CATEGORY_LABEL, categoryRank, type FleetAsset } from "@/components/fleet/types";
import type { FleetState } from "@/components/fleet/use-fleet";
import { addDays, checkReservation, formatSpan, isBlocking, mondayOf, parseDateKey, spanLength, toDateKey } from "@/lib/fleet-rules";
import { playUiSound } from "@/lib/ui-sounds";
import { cn } from "@/lib/cn";
import { ChevronIcon, MobileButton, MobileEmpty, MobileGroup, MobileSheet } from "../primitives";

/**
 * Book material on a phone: pick a unit from a grouped list, then pick the
 * days on a month calendar that shows what is already taken. Two taps set
 * the range (today is bookable, the past is not, the viewer's horizon caps
 * how far ahead). The server still has the last word (`reserve`), including
 * the waitlist when the span is contested.
 */
export function MobileBookFlow({ state, onBooked }: { state: FleetState; onBooked: () => void }) {
  const { bookableAssets, assets, search, setSearch } = state;
  const [asset, setAsset] = useState<FleetAsset | null>(null);
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = bookableAssets
      .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.model ?? "").toLowerCase().includes(q))
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name));
    const groups = new Map<FleetAsset["category"], FleetAsset[]>();
    for (const a of list) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
    return [...groups.entries()];
  }, [bookableAssets, search]);

  return (
    <>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search material"
        className="min-h-11 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink focus:border-accent/40 focus:outline-none"
      />
      {grouped.length === 0 ? (
        <MobileGroup>
          <MobileEmpty>{assets.length === 0 ? "The fleet is empty." : "Nothing bookable matches."}</MobileEmpty>
        </MobileGroup>
      ) : (
        grouped.map(([category, units]) => (
          <MobileGroup key={category} title={CATEGORY_LABEL[category]}>
            {units.map((unit) => (
              <button key={unit.id} type="button" onClick={() => setAsset(unit)} className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-glass/8">
                <AssetIcon category={unit.category} className="h-5 w-5 shrink-0 text-ink-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-ink">{unit.name}</span>
                  <span className="block truncate text-xs text-ink-4">{[unit.model, unit.current_location].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <ChevronIcon className="h-4 w-4 shrink-0 text-ink-5" />
              </button>
            ))}
          </MobileGroup>
        ))
      )}
      <DatePickerSheet state={state} asset={asset} onClose={() => setAsset(null)} onBooked={() => { setAsset(null); onBooked(); }} />
    </>
  );
}

function DatePickerSheet({ state, asset, onClose, onBooked }: { state: FleetState; asset: FleetAsset | null; onClose: () => void; onBooked: () => void }) {
  const { reservations, today, board, busy, post, setWindowStart } = state;
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(() => today.slice(0, 7));
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const horizonDays = board?.is_admin ? 365 : (board?.me.horizonDays ?? 56);

  const taken = useMemo(() => (asset ? reservations.filter((r) => r.asset_id === asset.id && isBlocking(r.status)) : []), [reservations, asset]);
  const takenDay = (key: string) => taken.some((r) => r.start_date <= key && r.end_date >= key);

  const monthDays = useMemo(() => {
    const first = `${month}-01`;
    const firstDate = parseDateKey(first);
    const daysInMonth = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)).getUTCDate();
    const lead = (firstDate.getUTCDay() + 6) % 7;
    const cells: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let i = 0; i < daysInMonth; i += 1) cells.push(addDays(first, i));
    return cells;
  }, [month]);

  const check = start && end ? checkReservation({ startDate: start, endDate: end, today, horizonDays, existing: taken }) : null;
  const problem = !check || check.ok ? null : check.reason === "past" ? "That start is in the past." : check.reason === "beyond_horizon" ? `Your score lets you book up to ${check.horizonDays} days ahead.` : check.reason === "too_long" ? `At most ${check.maxDays} days per booking.` : check.reason === "inverted" ? "The end is before the start." : null;
  const contested = check !== null && !check.ok && check.reason === "overlap";

  function tapDay(key: string) {
    if (key < today) return;
    if (!start || (start && end)) {
      setStart(key);
      setEnd(null);
      return;
    }
    if (key < start) {
      setStart(key);
      return;
    }
    setEnd(key);
  }

  function shiftMonth(delta: number) {
    const d = parseDateKey(`${month}-01`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    const next = toDateKey(d).slice(0, 7);
    setMonth(next);
    // Load that month's bookings into the board (the hook reads 28 days from a Monday).
    setWindowStart(mondayOf(`${next}-01`));
  }

  async function book(waitlist: boolean) {
    if (!asset || !start) return;
    const ok = await post({
      action: "reserve",
      asset_id: asset.id,
      start_date: start,
      end_date: end ?? start,
      destination: destination.trim() || undefined,
      purpose: purpose.trim() || undefined,
      waitlist,
    });
    if (ok) {
      playUiSound("switchWhoosh");
      setStart(null);
      setEnd(null);
      setDestination("");
      setPurpose("");
      onBooked();
    }
  }

  const monthDate = parseDateKey(`${month}-01`);
  const monthLabel = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const rangeEnd = end ?? start;
  const days = start && rangeEnd ? spanLength(start, rangeEnd) : 0;

  return (
    <MobileSheet
      open={asset !== null}
      onClose={() => { setStart(null); setEnd(null); onClose(); }}
      full
      title={asset ? `Book ${asset.name}` : "Book"}
      footer={
        <div className="space-y-2">
          {problem ? <p className="text-xs text-danger">{problem}</p> : null}
          {contested ? <p className="text-xs text-warn">Already booked on some of those days. You can join the waitlist instead.</p> : null}
          <MobileButton disabled={!start || busy || Boolean(problem) || contested} onClick={() => void book(false)}>
            {busy ? "Booking…" : start ? `Book ${formatSpan(start, rangeEnd ?? start)} · ${days} day${days === 1 ? "" : "s"}` : "Pick a start day"}
          </MobileButton>
          {contested ? (
            <MobileButton variant="secondary" disabled={busy} onClick={() => void book(true)}>
              Join the waitlist
            </MobileButton>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <p className="text-xs text-ink-4">Tap a start day, then an end day. Shaded days are already taken.</p>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
            <ChevronIcon className="h-5 w-5 rotate-180" />
          </button>
          <span className="text-[15px] font-semibold text-ink">{monthLabel}</span>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
            <ChevronIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-ink-5">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
            <span key={d} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {monthDays.map((key, i) =>
            key === null ? (
              <span key={`lead-${i}`} />
            ) : (
              <button
                key={key}
                type="button"
                disabled={key < today}
                onClick={() => tapDay(key)}
                aria-pressed={Boolean(start && key >= start && key <= (rangeEnd ?? start))}
                className={cn(
                  "relative flex h-11 items-center justify-center rounded-lg text-sm tabular-nums",
                  key < today ? "text-ink-5/50" : "text-ink active:bg-glass/10",
                  takenDay(key) && "bg-rose-500/15 text-danger",
                  start && key >= start && key <= (rangeEnd ?? start) && "bg-accent/25 font-semibold text-accent-soft",
                  key === today && "ring-1 ring-inset ring-accent/60",
                )}
              >
                {Number(key.slice(8, 10))}
              </button>
            ),
          )}
        </div>
        <div className="space-y-2">
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Going to (optional)" className="min-h-12 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink focus:border-accent/40 focus:outline-none" />
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Purpose (optional)" className="min-h-12 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink focus:border-accent/40 focus:outline-none" />
        </div>
      </div>
    </MobileSheet>
  );
}
