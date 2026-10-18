"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { dueLabel, formatSpan, occupiedUntil } from "@/lib/fleet-rules";
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

          return (
            <Row key={reservation.id} tone={overdue ? "alert" : "default"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {asset ? (
                      <AssetIcon category={asset.category} className="h-4 w-4 shrink-0 text-ink-4" />
                    ) : null}
                    <span className="text-xs font-medium text-ink">{asset?.name ?? "Material"}</span>
                    <Badge tone={stateTone(reservation, overdue)}>{stateLabel(reservation, overdue)}</Badge>
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
                      Leave waitlist
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
                        setReturnTo(asset?.home_location ?? "");
                        setReturnedOn(today);
                      }}
                    >
                      Bring back
                    </Button>
                  ) : null}
                </div>
              </div>

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
