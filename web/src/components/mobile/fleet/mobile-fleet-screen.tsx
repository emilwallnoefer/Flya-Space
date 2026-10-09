"use client";

import { useMemo, useState } from "react";
import { AssetIcon } from "@/components/fleet/asset-icon";
import { HolderColorProvider, useHolderRgb } from "@/components/fleet/holder-colors";
import { IdentityPrompt } from "@/components/fleet/identity-prompt";
import { ReliabilityBadge } from "@/components/fleet/reliability-badge";
import { CATEGORY_LABEL, categoryRank, type FleetAsset, type FleetBoardResponse, type FleetReservation } from "@/components/fleet/types";
import { useFleet, type FleetState } from "@/components/fleet/use-fleet";
import { Notice } from "@/components/ui";
import { dueLabel, formatDay, formatSpan, isBlocking, occupiedUntil } from "@/lib/fleet-rules";
import { cn } from "@/lib/cn";
import { MobileButton, MobileEmpty, MobileGroup, MobileSegmented, MobileSheet } from "../primitives";
import { MobileBookFlow } from "./mobile-book-flow";

type FleetView = "mine" | "book" | "who";

/**
 * The phone's Fleet: what I have, book something, who has what. No 28-column
 * grid — a phone cannot show it. Same hook as the desktop (`useFleet`), so
 * every write goes through the same `post` and comes back with the same
 * board; the rules (horizon, waitlist, reliability) are the server's.
 */
export function MobileFleetScreen({ initialBoard }: { initialBoard: FleetBoardResponse | null }) {
  const state = useFleet(initialBoard);
  const { board, loading, error, notice, busy, load, post, windowStart, myReservations, claimableByMe, unclaimedHolders, myDisplayName, holderRoster } = state;
  const [view, setView] = useState<FleetView>(myReservations.length > 0 ? "mine" : "book");
  const [detail, setDetail] = useState<FleetReservation | null>(null);

  return (
    <HolderColorProvider roster={holderRoster}>
      <div className="space-y-4 px-4 pt-1">
        <div className="flex items-center justify-between gap-2">
          {board ? <ReliabilityBadge score={board.me} /> : <span />}
          <button type="button" onClick={() => void load(windowStart)} disabled={loading} className="min-h-9 rounded-lg px-2 text-xs font-medium text-accent-soft active:bg-glass/8 disabled:opacity-50">
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {board?.auto_linked ? (
          <Notice tone="positive">
            Welcome back — <span className="font-medium">{board.auto_linked.label}</span> in the old fleet sheet is you. Your bookings now sit under your account.
          </Notice>
        ) : null}
        {board && !board.identity_confirmed ? (
          <IdentityPrompt
            displayName={board.me.user_id ? myDisplayName : "me"}
            suggestions={claimableByMe}
            allUnclaimed={unclaimedHolders}
            busy={busy}
            onClaim={(label) => void post({ action: "claim_holder", label })}
            onRegister={() => void post({ action: "register_member" })}
          />
        ) : null}
        <div aria-live="polite" className="empty:hidden">
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        </div>

        <MobileSegmented
          label="Fleet view"
          value={view}
          onChange={setView}
          options={[
            { value: "mine", label: myReservations.length > 0 ? `Mine · ${myReservations.length}` : "Mine" },
            { value: "book", label: "Book" },
            { value: "who", label: "Who has what" },
          ]}
        />

        {view === "mine" ? <MyMaterialList state={state} onBrowse={() => setView("book")} /> : null}
        {view === "book" ? <MobileBookFlow state={state} onBooked={() => setView("mine")} /> : null}
        {view === "who" ? <WhoHasWhat state={state} onOpen={setDetail} /> : null}

        <ReservationSheet state={state} reservation={detail} onClose={() => setDetail(null)} />
      </div>
    </HolderColorProvider>
  );
}

/* --------------------------------------------------------------- my material */

function MyMaterialList({ state, onBrowse }: { state: FleetState; onBrowse: () => void }) {
  const { myReservations, assets, today, busy, post } = state;
  const [returning, setReturning] = useState<FleetReservation | null>(null);
  const [returnTo, setReturnTo] = useState("");

  if (myReservations.length === 0) {
    return (
      <MobileGroup>
        <MobileEmpty>Nothing booked. Anything you take out shows up here with its return date.</MobileEmpty>
        <div className="px-4 pb-4">
          <MobileButton variant="secondary" onClick={onBrowse}>
            Book material
          </MobileButton>
        </div>
      </MobileGroup>
    );
  }

  return (
    <>
      <MobileGroup title="My material">
        {myReservations.map((r) => {
          const asset = assets.find((a) => a.id === r.asset_id);
          const overdue = r.days_overdue > 0;
          const label = r.status === "waitlisted" ? "Waitlisted" : r.status === "picked_up" ? (overdue ? "Overdue" : "With you") : r.status === "reserved" ? "Reserved" : r.status;
          return (
            <div key={r.id} className={cn("px-4 py-3", overdue && "bg-rose-500/[0.06]")}>
              <div className="flex items-start gap-3">
                {asset ? <AssetIcon category={asset.category} className="mt-0.5 h-5 w-5 shrink-0 text-ink-4" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[15px] text-ink">
                    <span className="truncate">{asset?.name ?? "Material"}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", overdue ? "bg-rose-500/20 text-danger" : r.status === "picked_up" ? "bg-accent/15 text-accent-soft" : "bg-glass/10 text-ink-3")}>
                      {label}
                    </span>
                  </p>
                  <p className={cn("mt-0.5 text-xs font-medium", overdue ? "text-danger" : "text-ink-3")}>{dueLabel(r.due_date, today)}</p>
                  <p className="text-xs text-ink-5">
                    {formatSpan(r.start_date, occupiedUntil(r))}
                    {r.destination ? ` · ${r.destination}` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex gap-2 pl-8">
                {r.status === "reserved" ? (
                  <>
                    <MobileButton className="min-h-10 text-sm" disabled={busy} onClick={() => void post({ action: "check_out", reservation_id: r.id })}>
                      Pick up
                    </MobileButton>
                    <MobileButton className="min-h-10 w-auto flex-none px-4 text-sm" variant="secondary" disabled={busy} onClick={() => void post({ action: "cancel", reservation_id: r.id })}>
                      Cancel
                    </MobileButton>
                  </>
                ) : null}
                {r.status === "waitlisted" ? (
                  <MobileButton className="min-h-10 text-sm" variant="secondary" disabled={busy} onClick={() => void post({ action: "cancel", reservation_id: r.id })}>
                    Leave waitlist
                  </MobileButton>
                ) : null}
                {r.status === "picked_up" ? (
                  <MobileButton className="min-h-10 text-sm" variant={overdue ? "primary" : "secondary"} disabled={busy} onClick={() => { setReturning(r); setReturnTo(asset?.home_location ?? ""); }}>
                    Bring back
                  </MobileButton>
                ) : null}
              </div>
            </div>
          );
        })}
      </MobileGroup>

      <MobileSheet
        open={returning !== null}
        onClose={() => setReturning(null)}
        title="Bring it back"
        footer={
          <MobileButton
            disabled={busy}
            onClick={async () => {
              if (!returning) return;
              if (await post({ action: "check_in", reservation_id: returning.id, location: returnTo.trim() || undefined })) setReturning(null);
            }}
          >
            {busy ? "Saving…" : "Checked in"}
          </MobileButton>
        }
      >
        <p className="text-sm text-ink-3">Where did you put {assets.find((a) => a.id === returning?.asset_id)?.name ?? "it"}?</p>
        <input
          value={returnTo}
          onChange={(e) => setReturnTo(e.target.value)}
          placeholder="Location (optional)"
          className="mt-3 min-h-12 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink focus:border-accent/40 focus:outline-none"
        />
      </MobileSheet>
    </>
  );
}

/* ------------------------------------------------------------- who has what */

function WhoHasWhat({ state, onOpen }: { state: FleetState; onOpen: (r: FleetReservation) => void }) {
  const { bookableAssets, reservations, today, search, setSearch } = state;
  const [category, setCategory] = useState<string>("all");
  const rgbOf = useHolderRgb();

  const categories = useMemo(() => [...new Set(bookableAssets.map((a) => a.category))].sort((a, b) => categoryRank(a) - categoryRank(b)), [bookableAssets]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookableAssets
      .filter((a) => category === "all" || a.category === category)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.model ?? "").toLowerCase().includes(q))
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name))
      .map((asset) => {
        const live = reservations
          .filter((r) => r.asset_id === asset.id && isBlocking(r.status) && r.start_date <= today && r.end_date >= today)
          .sort((a, b) => (a.status === "picked_up" ? -1 : 1) - (b.status === "picked_up" ? -1 : 1))[0];
        const next = live
          ? null
          : reservations.filter((r) => r.asset_id === asset.id && isBlocking(r.status) && r.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
        return { asset, live: live ?? null, next: next ?? null };
      });
  }, [bookableAssets, reservations, today, category, search]);

  return (
    <>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search material"
        className="min-h-11 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink focus:border-accent/40 focus:outline-none"
      />
      {categories.length > 1 ? (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {(["all", ...categories] as string[]).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", category === c ? "border-accent/50 bg-accent/15 text-accent-soft" : "border-glass/15 text-ink-3")}>
              {c === "all" ? "All" : CATEGORY_LABEL[c as FleetAsset["category"]]}
            </button>
          ))}
        </div>
      ) : null}
      <MobileGroup>
        {rows.length === 0 ? <MobileEmpty>Nothing matches.</MobileEmpty> : null}
        {rows.map(({ asset, live, next }) => (
          <button
            key={asset.id}
            type="button"
            disabled={!live}
            onClick={() => live && onOpen(live)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left enabled:active:bg-glass/8"
          >
            <AssetIcon category={asset.category} className="h-5 w-5 shrink-0 text-ink-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-ink">{asset.name}</span>
              <span className="block truncate text-xs text-ink-4">
                {live ? (
                  <>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: `rgb(${rgbOf(live.holder_name)})` }} aria-hidden />
                    {live.is_mine ? "You" : live.holder_name} · {live.status === "picked_up" ? "out" : "reserved"} until {formatDay(live.end_date)}
                  </>
                ) : next ? (
                  `Free · next booked ${formatDay(next.start_date)}`
                ) : (
                  `Free${asset.current_location ? ` · ${asset.current_location}` : ""}`
                )}
              </span>
            </span>
            {live ? <span className="text-xs text-ink-5">Details</span> : <span className="h-2 w-2 rounded-full bg-emerald-400" aria-label="Free" />}
          </button>
        ))}
      </MobileGroup>
    </>
  );
}

/* ------------------------------------------------------- reservation sheet */

function ReservationSheet({ state, reservation, onClose }: { state: FleetState; reservation: FleetReservation | null; onClose: () => void }) {
  const { assets, today, busy, post, board } = state;
  const rgbOf = useHolderRgb();
  const asset = reservation ? assets.find((a) => a.id === reservation.asset_id) : null;
  const canAct = reservation ? reservation.is_mine || Boolean(board?.is_admin) : false;
  const finished = reservation ? reservation.status === "returned" || reservation.status === "cancelled" : true;
  return (
    <MobileSheet open={reservation !== null} onClose={onClose} title={asset?.name ?? "Booking"}>
      {reservation ? (
        <div className="space-y-3 pb-2">
          <p className="flex items-center gap-2 text-[15px] text-ink">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `rgb(${rgbOf(reservation.holder_name)})` }} aria-hidden />
            {reservation.is_mine ? "You" : reservation.holder_name}
          </p>
          <dl className="space-y-1.5 text-sm">
            <Row k="Dates" v={formatSpan(reservation.start_date, reservation.end_date)} />
            <Row k="Status" v={reservation.status === "picked_up" ? "Out" : reservation.status} />
            <Row k="Due" v={dueLabel(reservation.due_date, today)} />
            {reservation.destination ? <Row k="Going to" v={reservation.destination} /> : null}
            {reservation.purpose ? <Row k="Purpose" v={reservation.purpose} /> : null}
          </dl>
          {canAct && !finished ? (
            <div className="flex gap-2 pt-2">
              {reservation.status === "picked_up" ? (
                <MobileButton disabled={busy} onClick={async () => { if (await post({ action: "check_in", reservation_id: reservation.id })) onClose(); }}>
                  Check it in
                </MobileButton>
              ) : null}
              <MobileButton variant="danger" disabled={busy} onClick={async () => { if (await post({ action: "cancel", reservation_id: reservation.id })) onClose(); }}>
                Cancel booking
              </MobileButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </MobileSheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-4">{k}</dt>
      <dd className="text-right capitalize text-ink">{v}</dd>
    </div>
  );
}
