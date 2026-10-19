"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { addDays, dueLabel, FLEET_HOME_LOCATION, formatSpan, MAX_RESERVATION_DAYS, occupiedUntil } from "@/lib/fleet-rules";
import { AssetIcon } from "./asset-icon";
import { ReliabilityCard } from "./reliability-badge";
import { EmptyState, Row } from "./ui";
import type { FleetAsset, FleetBoardResponse, FleetReservation } from "./types";

/**
 * The viewer's own material: what they have, what they owe back, and when.
 *
 * Every row leads with the single thing that decides what the reader does next
 * — "due back tomorrow", "2 days overdue" — because the exact dates below it
 * only matter once you already know whether you are late.
 */
export function MyMaterial({
  reservations,
  assets,
  today,
  busy,
  score,
  onCheckOut,
  onCheckIn,
  onCancel,
  onChangeDates,
  onBrowse,
}: {
  reservations: FleetReservation[];
  assets: FleetAsset[];
  today: string;
  busy: boolean;
  score: FleetBoardResponse["me"] | null;
  onCheckOut: (id: string) => void;
  /** `returnedOn` is set only when the person backdated an overdue return. */
  onCheckIn: (id: string, location: string, returnedOn?: string) => void;
  onCancel: (id: string) => void;
  /** Move the booking's last day; the server decides whether that is free, a request, or a shortening. */
  onChangeDates: (id: string, endDate: string) => void;
  /** Sends an empty-handed reader to the calendar rather than a dead end. */
  onBrowse: () => void;
}) {
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("");
  // Only asked for when the booking is overdue: the day it actually came back.
  const [returnedOn, setReturnedOn] = useState("");
  /** The backdated return day to send, or undefined when today is right. */
  const backdated = (reservation: FleetReservation) =>
    reservation.days_overdue > 0 && returnedOn && returnedOn !== today ? returnedOn : undefined;
  // "Change dates": which booking is being edited, and the new last day.
  const [changingId, setChangingId] = useState<string | null>(null);
  const [newEnd, setNewEnd] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="space-y-1.5">
        {reservations.length === 0 ? (
          <EmptyState
            title="Nothing booked"
            hint="Pick days in the calendar to reserve material. Anything you take out shows up here with its return date."
            action={
              <Button size="xs" variant="accent" onClick={onBrowse}>
                Open the calendar
              </Button>
            }
          />
        ) : null}

        {reservations.map((reservation) => {
          const asset = assets.find((a) => a.id === reservation.asset_id);
          const overdue = reservation.days_overdue > 0;
          const returning = returningId === reservation.id;
          const changing = changingId === reservation.id;
          const live = reservation.status === "reserved" || reservation.status === "picked_up";
          // A waitlisted row on an assigned unit is a borrow awaiting the assignee's approval, not a queue.
          const awaiting = reservation.status === "waitlisted" && asset?.pooled === false;

          return (
            <Row key={reservation.id} tone={overdue ? "alert" : "default"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {asset ? (
                      <AssetIcon category={asset.category} className="h-4 w-4 shrink-0 text-ink-4" />
                    ) : null}
                    <span className="text-xs font-medium text-ink">{asset?.name ?? "Material"}</span>
                    <Badge tone={stateTone(reservation, overdue)}>{awaiting ? "Awaiting approval" : stateLabel(reservation, overdue)}</Badge>
                    {reservation.imported ? (
                      <Badge
                        tone="neutral"
                        title="Carried over from the fleet sheet — does not affect your score"
                      >
                        From sheet
                      </Badge>
                    ) : null}
                  </div>

                  {/* The deadline, in the words the reader thinks in. */}
                  <p
                    className={`mt-1 text-[11px] font-medium ${
                      overdue ? "text-danger" : reservation.status === "picked_up" ? "text-ink-2" : "text-ink-4"
                    }`}
                  >
                    {dueLabel(reservation.due_date, today)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-5">
                    {formatSpan(reservation.start_date, occupiedUntil(reservation))}
                    {reservation.destination ? ` · going to ${reservation.destination}` : ""}
                    {awaiting && asset?.holder_name ? ` · asked ${asset.holder_name}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  {reservation.status === "reserved" ? (
                    <>
                      <Button
                        size="xs"
                        variant="accent"
                        disabled={busy}
                        onClick={() => onCheckOut(reservation.id)}
                      >
                        Pick up
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onCancel(reservation.id)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : null}
                  {reservation.status === "waitlisted" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onCancel(reservation.id)}
                    >
                      {awaiting ? "Withdraw request" : "Leave waitlist"}
                    </Button>
                  ) : null}
                  {reservation.status === "picked_up" ? (
                    <Button
                      size="xs"
                      variant={overdue ? "accent" : "glass"}
                      disabled={busy}
                      aria-expanded={returning}
                      onClick={() => {
                        setReturningId(returning ? null : reservation.id);
                        setReturnTo(FLEET_HOME_LOCATION);
                        setReturnedOn(today);
                      }}
                    >
                      Bring back
                    </Button>
                  ) : null}
                  {live ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      aria-expanded={changing}
                      onClick={() => {
                        setChangingId(changing ? null : reservation.id);
                        setNewEnd(reservation.end_date);
                        setReturningId(null);
                      }}
                    >
                      Change dates
                    </Button>
                  ) : null}
                </div>
              </div>

              {changing ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-glass/10 pt-2">
                  <span className="text-[11px] text-ink-4">Last day</span>
                  <Input
                    type="date"
                    value={newEnd}
                    autoFocus
                    min={reservation.start_date > today ? reservation.start_date : today}
                    max={addDays(reservation.start_date, MAX_RESERVATION_DAYS - 1)}
                    onChange={(event) => setNewEnd(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setChangingId(null);
                    }}
                    className="text-xs"
                    aria-label="New last day"
                  />
                  <Button
                    size="xs"
                    variant="accent"
                    disabled={busy || !newEnd || newEnd === reservation.end_date}
                    onClick={() => {
                      onChangeDates(reservation.id, newEnd);
                      setChangingId(null);
                    }}
                  >
                    {newEnd > reservation.end_date ? "Keep it longer" : "Give days back"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setChangingId(null)}>
                    Cancel
                  </Button>
                  {newEnd > reservation.end_date ? (
                    <span className="basis-full text-[11px] text-ink-5">
                      If someone has it booked for those days, they are asked first — nothing changes until they answer.
                    </span>
                  ) : null}
                </div>
              ) : null}

              {returning ? (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-glass/10 pt-2">
                  <Input
                    value={returnTo}
                    autoFocus
                    onChange={(event) => setReturnTo(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setReturningId(null);
                      if (event.key === "Enter") {
                        onCheckIn(reservation.id, returnTo.trim(), backdated(reservation));
                        setReturningId(null);
                      }
                    }}
                    placeholder="Where are you leaving it?"
                    className="min-w-[10rem] flex-1 text-xs"
                    aria-label="Return location"
                  />
                  {overdue ? (
                    // Overdue only: a unit dropped off on Friday and checked in
                    // on Monday was not three days late. Bounded to the booking.
                    <Input
                      type="date"
                      value={returnedOn}
                      min={reservation.start_date}
                      max={today}
                      onChange={(event) => setReturnedOn(event.target.value)}
                      className="text-xs"
                      aria-label="Day it actually came back"
                      title="When did it actually come back?"
                    />
                  ) : null}
                  <Button
                    size="xs"
                    variant="accent"
                    disabled={busy}
                    onClick={() => {
                      onCheckIn(reservation.id, returnTo.trim(), backdated(reservation));
                      setReturningId(null);
                    }}
                  >
                    Check in
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setReturningId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </Row>
          );
        })}
      </div>

      {score ? <ReliabilityCard score={score} /> : null}
    </div>
  );
}

function stateLabel(reservation: FleetReservation, overdue: boolean): string {
  if (overdue) return `${reservation.days_overdue}d overdue`;
  if (reservation.status === "picked_up") return "Out";
  if (reservation.status === "waitlisted") return `Waitlist #${reservation.queue_position ?? "?"}`;
  return "Booked";
}

function stateTone(reservation: FleetReservation, overdue: boolean) {
  if (overdue) return "danger" as const;
  if (reservation.status === "picked_up") return "accent" as const;
  return "neutral" as const;
}
