"use client";

import { m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { addDays, dueLabel, formatDayLong, formatSpan, MAX_RESERVATION_DAYS, occupiedUntil } from "@/lib/fleet-rules";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { AssetIcon } from "./asset-icon";
import { useHolderRgb } from "./holder-colors";
import type { FleetAsset, FleetReservation } from "./types";

/**
 * What one booking in the calendar actually is.
 *
 * A dialog rather than a block appended under the grid, which is where this
 * used to render: clicking a cell in row 12 scrolled the answer off-screen, so
 * the click appeared to do nothing. A dialog lands where the eye already is.
 */
export function ReservationDetail({
  reservation,
  asset,
  today,
  busy,
  onClose,
  onCheckIn,
  onCancel,
  onChangeDates,
}: {
  reservation: FleetReservation;
  asset: FleetAsset | null;
  today: string;
  busy: boolean;
  onClose: () => void;
  onCheckIn: (id: string) => void;
  onCancel: (id: string) => void;
  /** Move the booking's last day (own live bookings only). */
  onChangeDates?: (id: string, endDate: string) => void;
}) {
  const rgbOf = useHolderRgb();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  const [changing, setChanging] = useState(false);
  const [newEnd, setNewEnd] = useState(reservation.end_date);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const overdue = reservation.days_overdue > 0;
  const finished = reservation.status === "returned" || reservation.status === "cancelled";

  return (
    <>
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[140] bg-overlay/60 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <m.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Booking: ${asset?.name ?? "material"}`}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        // `overscroll-contain` so scrolling a long booking does not carry on
        // into the dashboard behind it once the dialog hits its end.
        className="fixed left-1/2 top-1/2 z-[141] max-h-[min(88dvh,40rem)] w-[min(94vw,26rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-glass/12 bg-panel shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        {/* The holder's own colour, as the header's edge: the same cue the
            calendar cell used, so the dialog is visibly about that cell. */}
        <div
          className="h-1 w-full"
          style={{ backgroundColor: `rgb(${rgbOf(reservation.holder_name)} / 0.85)` }}
          aria-hidden
        />

        <header className="flex items-start gap-2.5 border-b border-glass/10 px-4 py-3">
          {asset ? (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass/10 ring-1 ring-inset ring-glass/15">
              <AssetIcon category={asset.category} className="h-4 w-4 text-ink-3" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-ink">{asset?.name ?? "Material"}</h2>
            <p className="mt-0.5 truncate text-[11px] text-ink-4">
              {reservation.is_mine ? "Booked by you" : `Booked by ${reservation.holder_name}`}
            </p>
          </div>
          <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="space-y-2.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {overdue ? <Badge tone="danger">{reservation.days_overdue}d overdue</Badge> : null}
            {reservation.status === "picked_up" && !overdue ? <Badge tone="accent">Out</Badge> : null}
            {reservation.status === "reserved" ? <Badge tone="neutral">Booked</Badge> : null}
            {reservation.status === "returned" ? <Badge tone="positive">Returned</Badge> : null}
            {reservation.unclaimed ? (
              <Badge tone="warn" title="From the old sheet — nobody has claimed this name yet">
                Unclaimed
              </Badge>
            ) : null}
            {reservation.imported ? <Badge tone="neutral">From sheet</Badge> : null}
          </div>

          <dl className="space-y-1.5 text-[11px]">
            <Field label="Days">{formatSpan(reservation.start_date, occupiedUntil(reservation))}</Field>
            <Field label="Due back">
              {formatDayLong(reservation.due_date)}
              {!finished ? (
                <span className={overdue ? " text-danger" : " text-ink-5"}>
                  {" "}
                  · {dueLabel(reservation.due_date, today)}
                </span>
              ) : null}
            </Field>
            {reservation.returned_on ? (
              <Field label="Came back">{formatDayLong(reservation.returned_on)}</Field>
            ) : null}
            {reservation.destination ? <Field label="Going to">{reservation.destination}</Field> : null}
            {reservation.purpose ? <Field label="What for">{reservation.purpose}</Field> : null}
            {asset?.current_location ? <Field label="Location">{asset.current_location}</Field> : null}
          </dl>
        </div>

        {reservation.is_mine && (reservation.status === "picked_up" || reservation.status === "reserved") ? (
          <footer className="flex flex-wrap gap-1.5 border-t border-glass/10 px-4 py-3">
            {reservation.status === "picked_up" ? (
              <Button size="xs" variant="accent" disabled={busy} onClick={() => onCheckIn(reservation.id)}>
                Check it in
              </Button>
            ) : (
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => onCancel(reservation.id)}>
                Cancel booking
              </Button>
            )}
            {onChangeDates ? (
              <Button size="xs" variant="ghost" disabled={busy} aria-expanded={changing} onClick={() => setChanging((v) => !v)}>
                Change dates
              </Button>
            ) : null}
            {onChangeDates && changing ? (
              <div className="flex basis-full flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-ink-4">Last day</span>
                <Input
                  type="date"
                  value={newEnd}
                  autoFocus
                  min={reservation.start_date > today ? reservation.start_date : today}
                  max={addDays(reservation.start_date, MAX_RESERVATION_DAYS - 1)}
                  onChange={(event) => setNewEnd(event.target.value)}
                  className="text-xs"
                  aria-label="New last day"
                />
                <Button
                  size="xs"
                  variant="accent"
                  disabled={busy || !newEnd || newEnd === reservation.end_date}
                  onClick={() => onChangeDates(reservation.id, newEnd)}
                >
                  {newEnd > reservation.end_date ? "Keep it longer" : "Give days back"}
                </Button>
                {newEnd > reservation.end_date ? (
                  <span className="basis-full text-[11px] text-ink-5">
                    If someone has it booked for those days, they are asked first — nothing changes until they answer.
                  </span>
                ) : null}
              </div>
            ) : null}
          </footer>
        ) : null}
      </m.div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-ink-5">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink-2">{children}</dd>
    </div>
  );
}
