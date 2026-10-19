"use client";

import { Badge, Button } from "@/components/ui";
import { requestStatusLabel, shortenedStartFor, type FleetRequestView, type RequestReply } from "@/lib/fleet-requests";
import { formatDayLong, formatSpan } from "@/lib/fleet-rules";
import { Row } from "./ui";

/**
 * Requests, in and out: extensions (free my days?) and borrows (lend me your
 * unit?).
 *
 * Shared by the desktop's Mine tab and the phone's Mine view — it is plain
 * primitives, so it wears whichever skin the shell gives it. An incoming
 * request is a question with a few answers; nothing on anyone's booking changes
 * until the person taps one. An outgoing one shows where it stands.
 */
export function RequestsStrip({
  requests,
  busy,
  onRespond,
  onMove,
  onRequest,
}: {
  requests: FleetRequestView[];
  busy: boolean;
  onRespond: (requestId: string, reply: RequestReply) => void;
  /** Move the recipient's own booking to a free unit of the same type; the request is granted by that. */
  onMove: (reservationId: string, assetId: string) => void;
  /** Ask for an assigned unit of the same type for the recipient's own days (files a borrow request). */
  onRequest?: (assetId: string, startDate: string, endDate: string) => void;
}) {
  if (requests.length === 0) return null;
  const incoming = requests.filter((r) => r.incoming);
  const outgoing = requests.filter((r) => r.outgoing && !r.incoming);

  return (
    <div className="space-y-1.5" aria-label="Requests">
      {incoming.map((r) => {
        const pending = r.status === "pending";
        if (r.kind === "borrow") {
          return (
            <Row key={r.id} tone={pending ? "alert" : "default"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={pending ? "warn" : "neutral"}>{pending ? "Needs your answer" : "Answered"}</Badge>
                    <span className="text-xs font-medium text-ink">
                      {r.requester_name} asks to borrow {r.asset_name} {formatSpan(r.target_start_date, r.target_end_date)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-3">
                    {r.recipient_id ? "It is assigned to you." : `It is assigned to ${r.recipient_name}, who has no account — you answer as an admin.`}
                    {pending ? " Nothing is booked until you approve." : ` ${requestStatusLabel(r.status, r.resolution, "borrow")}.`}
                  </p>
                </div>
                {pending ? (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button size="xs" variant="accent" disabled={busy} onClick={() => onRespond(r.id, "approve")}>
                      Approve
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRespond(r.id, "decline")}>
                      Decline
                    </Button>
                  </div>
                ) : null}
              </div>
            </Row>
          );
        }

        const laterStart = shortenedStartFor({ end_date: r.target_end_date }, r.requested_end_date);
        const free = r.alternatives.filter((a) => !a.assigned);
        const assigned = r.alternatives.filter((a) => a.assigned);
        return (
          <Row key={r.id} tone={pending ? "alert" : "default"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={pending ? "warn" : "neutral"}>{pending ? "Needs your answer" : "Answered"}</Badge>
                  <span className="text-xs font-medium text-ink">
                    {r.requester_name} needs {r.asset_name} until {formatDayLong(r.requested_end_date)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-3">
                  That runs into your booking {formatSpan(r.target_start_date, r.target_end_date)}.
                  {pending
                    ? " Nothing changes until you answer; if you need the days, decline and get in touch."
                    : ` ${requestStatusLabel(r.status, r.resolution)}.`}
                </p>
              </div>
              {pending ? (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {/* Best answer when it exists: keep your days, on another unit. */}
                  {free.map((alt) => (
                    <Button key={alt.asset_id} size="xs" variant="accent" disabled={busy} onClick={() => onMove(r.target_reservation_id ?? r.reservation_id, alt.asset_id)}>
                      Move to {alt.name}{alt.location ? ` · ${alt.location}` : ""}
                    </Button>
                  ))}
                  {/* Second best: ask for an assigned twin. Their holder approves; this booking stays until then. */}
                  {onRequest
                    ? assigned.map((alt) => (
                        <Button key={alt.asset_id} size="xs" variant="glass" disabled={busy} onClick={() => onRequest(alt.asset_id, r.target_start_date, r.target_end_date)}>
                          Ask {alt.holder ?? "the assignee"} for {alt.name}
                        </Button>
                      ))
                    : null}
                  {laterStart ? (
                    <Button size="xs" variant={free.length > 0 ? "glass" : "accent"} disabled={busy} onClick={() => onRespond(r.id, "shorten")}>
                      Start {formatDayLong(laterStart)} instead
                    </Button>
                  ) : null}
                  <Button size="xs" variant="glass" disabled={busy} onClick={() => onRespond(r.id, "cancel")}>
                    Cancel my booking
                  </Button>
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRespond(r.id, "decline")}>
                    Decline
                  </Button>
                </div>
              ) : null}
            </div>
          </Row>
        );
      })}

      {outgoing.map((r) => (
        <Row key={r.id} tone="default">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={r.status === "pending" ? "neutral" : r.status === "accepted" ? "positive" : "warn"}>
              {r.status === "pending" ? "Asked" : r.status === "accepted" && r.kind === "borrow" ? "approved" : r.status}
            </Badge>
            <span className="text-xs text-ink-2">
              {r.kind === "borrow"
                ? `You asked ${r.recipient_name} for ${r.asset_name} ${formatSpan(r.target_start_date, r.target_end_date)}`
                : `You asked ${r.recipient_name} to free ${r.asset_name} until ${formatDayLong(r.requested_end_date)}`}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-4">{requestStatusLabel(r.status, r.resolution, r.kind)}</p>
        </Row>
      ))}
    </div>
  );
}
