import { formatDayLong, formatSpan } from "./fleet-rules";

/**
 * The notices the Fleet sends to people other than the holder — the next
 * booker, the person who asked for more days, the admins — rendered once for
 * both channels (a push to the phone; an e-mail when no device is subscribed).
 *
 * Pure and dependency-free, like `role-assignment-notice-email.ts`: no env,
 * no Supabase, no clock. `fleet-notify.ts` is the "server-only" side that
 * claims the send-once row and delivers.
 *
 * Every notice deep-links to ONE booking (`/dashboard?module=fleet&reservation=…`),
 * the reader's own where there is one, so a tap lands on the thing to act on.
 */

export type FleetNoticeKind =
  | "unit_not_back"
  | "extension_request"
  | "extension_accepted"
  | "extension_declined"
  | "waitlist_promoted"
  | "unit_back_early"
  | "overdue_escalation"
  | "borrow_request"
  | "borrow_approved"
  | "borrow_declined";

export type FleetNoticeInput =
  | {
      kind: "unit_not_back";
      assetName: string;
      /** Null when the holder has no account (a sheet booking): the reader is told to ask an admin. */
      holderName: string | null;
      dueDate: string;
      nextStart: string;
      nextEnd: string;
      linkReservationId: string;
      /** Names of free units of the same kind for the reader's days, if any. */
      alternatives?: string[];
    }
  | {
      kind: "extension_request";
      assetName: string;
      requesterName: string;
      requestedEnd: string;
      targetStart: string;
      targetEnd: string;
      linkReservationId: string;
      /** Names of free units of the same kind the reader could move to, if any. */
      alternatives?: string[];
    }
  | {
      kind: "extension_accepted";
      assetName: string;
      answererName: string;
      requestedEnd: string;
      /** False when they agreed but the days were still taken by someone else. */
      applied: boolean;
      linkReservationId: string;
    }
  | {
      kind: "extension_declined";
      assetName: string;
      answererName: string;
      currentEnd: string;
      linkReservationId: string;
    }
  | {
      kind: "waitlist_promoted";
      assetName: string;
      startDate: string;
      endDate: string;
      linkReservationId: string;
    }
  | {
      kind: "unit_back_early";
      assetName: string;
      holderName: string;
      returnedOn: string;
      nextStart: string;
      nextEnd: string;
      linkReservationId: string;
    }
  | {
      kind: "overdue_escalation";
      assetName: string;
      holderName: string;
      /** False when the holder has no account: nobody has been reminded by mail. */
      holderHasAccount: boolean;
      dueDate: string;
      daysLate: number;
      nextHolderName: string | null;
      nextStart: string | null;
      linkReservationId: string;
    }
  | {
      kind: "borrow_request";
      assetName: string;
      requesterName: string;
      startDate: string;
      endDate: string;
      /** Set when the unit's assignee has no account and the admins are asked instead. */
      assignedTo: string | null;
      linkReservationId: string;
    }
  | {
      kind: "borrow_approved";
      assetName: string;
      answererName: string;
      startDate: string;
      endDate: string;
      linkReservationId: string;
    }
  | {
      kind: "borrow_declined";
      assetName: string;
      answererName: string;
      startDate: string;
      endDate: string;
      linkReservationId: string;
    };

export type RenderedNotice = {
  push: { title: string; body: string; url: string; tag: string };
  email: { subject: string; text: string; html: string };
};

/** Where a tap lands: the Fleet module with this booking's dialog open. */
export function fleetReservationDeepLink(reservationId: string): string {
  return `/dashboard?module=fleet&reservation=${encodeURIComponent(reservationId)}`;
}

/** Joins the origin and the deep link without doubling or dropping the slash. */
export function fleetReservationUrl(baseUrl: string, reservationId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${fleetReservationDeepLink(reservationId)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function day(dateKey: string): string {
  try {
    return formatDayLong(dateKey);
  } catch {
    return dateKey;
  }
}

/** "SVA-330 is free for those days" / "SVA-330 and SVA-400 are free for those days", or null. */
function freeLine(alternatives: string[] | undefined): string | null {
  if (!alternatives || alternatives.length === 0) return null;
  const list = alternatives.length <= 2 ? alternatives.join(" and ") : `${alternatives.slice(0, 2).join(", ")} and ${alternatives.length - 2} more`;
  return `${list} ${alternatives.length === 1 ? "is" : "are"} free for those days — you can move your booking there in Fleet.`;
}

/** One sentence each: what happened, what it means for the reader, what to do. */
function compose(input: FleetNoticeInput): { title: string; lines: string[]; cta: string } {
  switch (input.kind) {
    case "unit_not_back": {
      const who = input.holderName ?? "the previous holder";
      const free = freeLine(input.alternatives);
      return {
        title: `${input.assetName} has not come back yet`,
        lines: [
          `${who} was due to return ${input.assetName} on ${day(input.dueDate)}, and it has not been checked in.`,
          `Your booking runs ${formatSpan(input.nextStart, input.nextEnd)}.`,
          free ??
            (input.holderName
              ? `Get in touch with ${input.holderName} to find a solution — or book another unit if one is free.`
              : "That booking has no account behind it, so ask an admin — or book another unit if one is free."),
        ],
        cta: "Open my booking",
      };
    }
    case "extension_request": {
      const free = freeLine(input.alternatives);
      return {
        title: `${input.requesterName} needs ${input.assetName} until ${day(input.requestedEnd)}`,
        lines: [
          `That runs into your booking ${formatSpan(input.targetStart, input.targetEnd)}.`,
          free
            ? `Nothing changes until you answer. ${free}`
            : "Nothing changes until you answer: start later, cancel your booking, or decline and get in touch.",
        ],
        cta: "Answer in Fleet",
      };
    }
    case "extension_accepted":
      return input.applied
        ? {
            title: `${input.assetName} is yours until ${day(input.requestedEnd)}`,
            lines: [`${input.answererName} freed the days. Your booking now ends ${day(input.requestedEnd)}.`],
            cta: "Open my booking",
          }
        : {
            title: `${input.answererName} agreed, but ${input.assetName} is still taken`,
            lines: [
              `${input.answererName} freed their days, but someone else still has ${input.assetName} booked before ${day(input.requestedEnd)}.`,
              "Your booking is unchanged. Check the calendar, or ask the other person too.",
            ],
            cta: "Open Fleet",
          };
    case "extension_declined":
      return {
        title: `${input.answererName} needs ${input.assetName} on those days`,
        lines: [
          `They declined to free the days. Your booking still ends ${day(input.currentEnd)}.`,
          `Get in touch with ${input.answererName} to find a solution, or book another unit if one is free.`,
        ],
        cta: "Open my booking",
      };
    case "waitlist_promoted":
      return {
        title: `${input.assetName} is yours ${formatSpan(input.startDate, input.endDate)}`,
        lines: ["A spot opened up and you were next on the waitlist. It is booked to you now.", "Not needed any more? Cancel it so the next person gets it."],
        cta: "Open my booking",
      };
    case "unit_back_early":
      return {
        title: `${input.assetName} is back early`,
        lines: [
          `${input.holderName} brought it back on ${day(input.returnedOn)}.`,
          `Your booking ${formatSpan(input.nextStart, input.nextEnd)} can start whenever you like.`,
        ],
        cta: "Open my booking",
      };
    case "overdue_escalation":
      return {
        title: `${input.assetName}: ${input.daysLate} days overdue with ${input.holderName}`,
        lines: [
          `${input.assetName} was due back on ${day(input.dueDate)} and is still out with ${input.holderName}.`,
          input.holderHasAccount
            ? "They have had daily reminders for a week with no check-in."
            : "That booking has no account behind it, so nobody has been reminded by mail.",
          input.nextHolderName && input.nextStart
            ? `${input.nextHolderName} has it booked from ${day(input.nextStart)}.`
            : "Nobody has it booked next.",
        ],
        cta: "Open the booking",
      };
    case "borrow_request":
      return {
        title: `${input.requesterName} asks to borrow ${input.assetName}`,
        lines: [
          input.assignedTo
            ? `${input.assetName} is assigned to ${input.assignedTo}, who has no account here, so this comes to you as an admin.`
            : `${input.assetName} is assigned to you.`,
          `${input.requesterName} would like it ${formatSpan(input.startDate, input.endDate)}. Nothing is booked until you approve.`,
        ],
        cta: "Approve or decline in Fleet",
      };
    case "borrow_approved":
      return {
        title: `${input.assetName} is yours ${formatSpan(input.startDate, input.endDate)}`,
        lines: [
          `${input.answererName} approved your request. It is booked to you now — pick it up from them on the day, and check it in when you bring it back.`,
        ],
        cta: "Open my booking",
      };
    case "borrow_declined":
      return {
        title: `${input.answererName} cannot lend ${input.assetName}`,
        lines: [
          `Your request for ${formatSpan(input.startDate, input.endDate)} was declined.`,
          `Ask ${input.answererName} directly if it is urgent, or book another unit of the same model.`,
        ],
        cta: "Open Fleet",
      };
  }
}

export function renderFleetNotice(input: FleetNoticeInput, baseUrl: string): RenderedNotice {
  const { title, lines, cta } = compose(input);
  const path = fleetReservationDeepLink(input.linkReservationId);
  const url = fleetReservationUrl(baseUrl, input.linkReservationId);

  const text = ["Hi,", "", ...lines, "", `${cta}: ${url}`, "", "— Flya Space, Fleet"].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b1120;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
    <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:14px;padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#38bdf8;">Flyability Fleet</p>
      <h1 style="margin:0 0 18px;font-size:19px;font-weight:600;color:#f8fafc;">${escapeHtml(title)}</h1>
      ${lines.map((line) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;">${escapeHtml(line)}</p>`).join("\n      ")}
      <a href="${escapeHtml(url)}" style="display:inline-block;margin-top:8px;background:#22d3ee;color:#0b1120;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9px;">${escapeHtml(cta)}</a>
      <p style="margin:22px 0 0;font-size:12px;color:#64748b;">— Flya Space, Fleet</p>
    </div>
  </body>
</html>`;

  return {
    push: { title, body: lines[0], url: path, tag: `fleet-${input.kind}-${input.linkReservationId}` },
    email: { subject: title, text, html },
  };
}
