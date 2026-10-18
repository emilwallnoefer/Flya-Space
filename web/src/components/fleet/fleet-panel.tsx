"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { writeViewParams } from "@/lib/view-params";
import type { AssetDraft } from "./asset-dialog";
import { CalendarTab } from "./calendar-tab";
import { FleetToolbar } from "./fleet-toolbar";
import { HolderColorProvider } from "./holder-colors";
import { IdentityPrompt } from "./identity-prompt";
import { ManageMaterial } from "./manage-material";
import { MaterialList } from "./material-list";
import { MyMaterial } from "./my-material";
import { ReliabilityBadge } from "./reliability-badge";
import { RequestsStrip } from "./requests-strip";
import { ReservationDetail } from "./reservation-detail";
import { Standings } from "./standings";
import { useFleet, type FleetTab } from "./use-fleet";
import type { FleetBoardResponse, FleetReservation } from "./types";

/**
 * Fleet — material tracking and day-level booking.
 *
 * Built to replace the shared Google Sheet, whose three failures this panel
 * answers directly:
 *   - booking was a merged-cell mess     -> click days in a grid
 *   - you could not tell who had what    -> every unit carries its holder's
 *                                           colour, in the register and the grid
 *   - nothing chased late returns        -> a daily reminder cron, plus a
 *                                           reliability score that ranks you in
 *                                           the queue for contested days
 *
 * This file is the orchestrator only: the state lives in `use-fleet.ts` and
 * each tab is its own component, the same split the Time Tracker and Mail
 * Tracking modules use.
 */
export function FleetPanel({ initialBoard = null }: { initialBoard?: FleetBoardResponse | null }) {
  const state = useFleet(initialBoard);
  const {
    board,
    loading,
    error,
    notice,
    busy,
    load,
    post,
    tab,
    setTab,
    windowStart,
    today,
    assets,
    visibleAssets,
    bookableAssets,
    myReservations,
    unclaimedHolders,
    claimableByMe,
    knownPeople,
    holderRoster,
    myDisplayName,
  } = state;

  const [detail, setDetail] = useState<FleetReservation | null>(null);

  // Opened from a notice (`?module=fleet&reservation=<id>`): land on that
  // booking's dialog once the board that holds it is here, then drop the param
  // so a reload does not reopen it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("reservation");
    if (!id) return;
    const match = state.reservations.find((r) => r.id === id);
    if (!match) return;
    // Next frame, as the phone shell does for `?chat=open`: the URL is only
    // known in the browser, and the state change must not run inside render.
    const frame = requestAnimationFrame(() => {
      setDetail(match);
      writeViewParams({ reservation: null });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.reservations]);

  const tabs: Array<[FleetTab, string, number | null]> = [
    ["calendar", "Calendar", bookableAssets.length || null],
    ["mine", "My material", myReservations.length || null],
    ["material", "Material", assets.length || null],
    // Configuring the fleet is admin-only: this list is shared reference data,
    // and a stray entry lands in everyone's calendar.
    ...(board?.is_admin ? ([["manage", "Manage", null]] as Array<[FleetTab, string, number | null]>) : []),
  ];

  return (
    // Colours are allocated once per board, here, so every screen below agrees
    // about which colour a person is — and so that no two people on the board
    // can end up wearing the same one.
    <HolderColorProvider roster={holderRoster}>
      <Card padding="lg" className="space-y-3">
        {/* ----------------------------------------------------------- header */}
        {/* One line. The strapline that used to sit under the title explained the
            module to someone who had already opened it, and cost a whole band of
            height above the grid on every visit. */}
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">Fleet</h2>
            <Badge tone="warn">Beta</Badge>
          </div>
          <div className="flex items-center gap-2">
            {board ? <ReliabilityBadge score={board.me} /> : null}
            <Button
              size="xs"
              variant="glass-quiet"
              onClick={() => void load(windowStart)}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </header>

        {/* Matched automatically on sign-in. Announced rather than silent: this
            moved bookings onto their account, and they should know it happened. */}
        {board?.auto_linked ? (
          <Notice tone="positive">
            Welcome back — <span className="font-medium">{board.auto_linked.label}</span> in the old fleet sheet is
            you.{" "}
            {board.auto_linked.bookings > 0
              ? `${board.auto_linked.bookings} booking${board.auto_linked.bookings === 1 ? "" : "s"}`
              : "No bookings"}
            {board.auto_linked.assets > 0
              ? ` and ${board.auto_linked.assets} assigned unit${board.auto_linked.assets === 1 ? "" : "s"}`
              : ""}{" "}
            now sit under your account. Tell an admin if that is wrong.
          </Notice>
        ) : null}

        {/* Asked once per person, server-tracked — see IdentityPrompt. */}
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

        {/* A write's result is announced, not just drawn: the toast-shaped
            feedback here ("waitlisted", "promoted") is the only confirmation a
            booking gives, and a screen reader would otherwise miss it. */}
        <div aria-live="polite" className="empty:hidden">
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        </div>

        <FleetToolbar state={state} tabs={tabs} />

        {/* ------------------------------------------------------------ tabs */}
        {/* One panel, re-rendered per tab, rather than four mounted panels with
            three hidden: the calendar alone is ~400 cells, and keeping it mounted
            behind Manage would cost that on every board refresh. */}
        <div role="tabpanel" id="fleet-tabpanel" aria-labelledby={`fleet-tab-${tab}`}>
          {tab === "calendar" ? (
            <CalendarTab state={state} onOpenReservation={setDetail} onManage={() => setTab("manage")} />
          ) : null}

          {tab === "material" ? <MaterialList assets={visibleAssets} /> : null}

          {tab === "mine" ? (
            <div className="space-y-4">
              <RequestsStrip
                requests={board?.requests ?? []}
                busy={busy}
                onRespond={(requestId, reply) => void post({ action: "respond_request", request_id: requestId, reply })}
              />
              <MyMaterial
                reservations={myReservations}
                assets={assets}
                today={today}
                busy={busy}
                score={board?.me ?? null}
                onCheckOut={(id) => void post({ action: "check_out", reservation_id: id })}
                onCheckIn={(id, location, returnedOn) =>
                  void post({
                    action: "check_in",
                    reservation_id: id,
                    location: location || undefined,
                    returned_on: returnedOn || undefined,
                  })
                }
                onCancel={(id) => void post({ action: "cancel", reservation_id: id })}
                onChangeDates={(id, endDate) => void post({ action: "change_dates", reservation_id: id, end_date: endDate })}
                onBrowse={() => setTab("calendar")}
              />
            </div>
          ) : null}

          {tab === "manage" && board?.is_admin ? (
            <ManageMaterial
              assets={assets}
              archived={board.archived_assets ?? []}
              unclaimed={unclaimedHolders}
              people={knownPeople}
              busy={busy}
              onCreate={(draft) => post({ action: "create_asset", ...assetFields(draft) })}
              onUpdate={(assetId, draft) =>
                post({ action: "update_asset", asset_id: assetId, ...assetFields(draft), status: draft.status })
              }
              onArchive={(assetId, archivedFlag) =>
                void post({ action: "archive_asset", asset_id: assetId, archived: archivedFlag })
              }
              remindersEnabled={board.reminders_enabled}
              onSetReminders={(enabled) => void post({ action: "set_reminders", enabled })}
              standings={<Standings board={board} />}
            />
          ) : null}
        </div>

        {detail ? (
          <ReservationDetail
            reservation={detail}
            asset={assets.find((a) => a.id === detail.asset_id) ?? null}
            today={today}
            busy={busy}
            onClose={() => setDetail(null)}
            onCheckIn={async (id) => {
              if (await post({ action: "check_in", reservation_id: id })) setDetail(null);
            }}
            onCancel={async (id) => {
              if (await post({ action: "cancel", reservation_id: id })) setDetail(null);
            }}
            onChangeDates={async (id, endDate) => {
              if (await post({ action: "change_dates", reservation_id: id, end_date: endDate })) setDetail(null);
            }}
          />
        ) : null}
      </Card>
    </HolderColorProvider>
  );
}

/**
 * A draft from the asset dialog, as the API wants it.
 *
 * Every field is sent, empty ones included, rather than dropping the empties.
 * Both route handlers already read `"" → null`, so sending the empty string is
 * how you CLEAR a value — omitting it would mean the dialog could set a note or
 * a location but never take one away. The holder label is safe to send whatever
 * the pooled flag says: `handleUpdateAsset` nulls it when a unit goes back into
 * the pool, and `handleCreateAsset` ignores it for a pooled unit.
 */
function assetFields(draft: AssetDraft) {
  return {
    name: draft.name.trim(),
    category: draft.category,
    serial_number: draft.serial_number.trim(),
    model: draft.model.trim(),
    owner_group: draft.owner_group.trim(),
    pooled: draft.pooled,
    home_location: draft.home_location.trim(),
    current_location: draft.current_location.trim(),
    current_holder_label: draft.current_holder_label.trim(),
    notes: draft.notes.trim(),
  };
}
