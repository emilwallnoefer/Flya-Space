"use client";

import { Badge, Button } from "@/components/ui";
import { requestStatusLabel, shortenedStartFor, type FleetRequestView, type RequestReply } from "@/lib/fleet-requests";
import { formatDayLong, formatSpan } from "@/lib/fleet-rules";
import { Row } from "./ui";

/**
 * Extension requests, in and out.
 *
 * Shared by the desktop's Mine tab and the phone's Mine view — it is plain
 * primitives, so it wears whichever skin the shell gives it. An incoming
 * request is a question with three answers; nothing on anyone's booking changes
 * until the person taps one. An outgoing one shows where it stands.
 */
export function RequestsStrip({
  requests,
  busy,
  onRespond,
  onMove,
}: {
  requests: FleetRequestView[];
  busy: boolean;
  onRespond: (requestId: string, reply: RequestReply) => void;
  /** Move the recipient's own booking to a free unit of the same kind; the request is granted by that. */
  onMove: (reservationId: string, assetId: string) => void;
}) {
  if (requests.length === 0) return null;
  const incoming = requests.filter((r) => r.incoming);
  const outgoing = requests.filter((r) => r.outgoing && !r.incoming);

  return (
    <div className="space-y-1.5" aria-label="Extension requests">
      {incoming.map((r) => {
        const laterStart = shortenedStartFor({ end_date: r.target_end_date }, r.requested_end_date);
        const pending = r.status === "pending";
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
                  {r.alternatives.map((alt) => (
                    <Button key={alt.asset_id} size="xs" variant="accent" disabled={busy} onClick={() => onMove(r.target_reservation_id, alt.asset_id)}>
                      Move to {alt.name}{alt.location ? ` · ${alt.location}` : ""}
                    </Button>
                  ))}
                  {laterStart ? (
                    <Button size="xs" variant={r.alternatives.length > 0 ? "glass" : "accent"} disabled={busy} onClick={() => onRespond(r.id, "shorten")}>
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
              {r.status === "pending" ? "Asked" : r.status}
            </Badge>
            <span className="text-xs text-ink-2">
              You asked {r.recipient_name} to free {r.asset_name} until {formatDayLong(r.requested_end_date)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-4">{requestStatusLabel(r.status, r.resolution)}</p>
        </Row>
      ))}
    </div>
  );
}
