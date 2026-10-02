import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardAdmin } from "@/lib/admin-guard";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { displayNameFor, fetchRemindersEnabled, todayInZurich } from "@/lib/fleet-queries";
import {
  computeReliability,
  dueDateOf,
  daysOverdue,
  formatDayLong,
  formatSpan,
  reminderFor,
  type ReminderKind,
  type ReservationSource,
  type ReservationSpan,
  type ReservationStatus,
} from "@/lib/fleet-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fleet return reminders.
 *
 * The reason the old spreadsheet failed was not that people were unwilling —
 * nothing ever told them their material was due. This route is that telling.
 *
 * Runs daily (see `web/vercel.json`). For every reservation that is still out:
 *   - the day before it is due  -> a heads-up
 *   - the day it is due         -> "bring it back today"
 *   - after that                -> daily for a week, then every third day,
 *                                  each one naming the reliability cost
 *
 * `fleet_reminder_sends` has a unique index on (reservation_id, kind, date), so
 * a retried or double-fired cron cannot mail the same person twice.
 *
 * Auth mirrors `/api/cron/time-log-reminder`: `Authorization: Bearer $CRON_SECRET`
 * from Vercel, or an admin session for manual runs.
 * Query params: `?dry=1` (decide + record nothing), `?preview=html|text`,
 * `?send_test=<email>`, `?force=1`.
 */

type LiveReservation = {
  id: string;
  asset_id: string;
  /** Null while the booking is filed under a name with no account behind it. */
  user_id: string | null;
  start_date: string;
  end_date: string;
  status: ReservationStatus;
  destination: string | null;
  returned_on: string | null;
  holder_label: string | null;
};

/** The narrower row shape used to recompute each recipient's reliability. */
type ScoringReservation = {
  id: string;
  asset_id: string;
  user_id: string | null;
  start_date: string;
  end_date: string;
  status: ReservationStatus;
  returned_on: string | null;
  source: ReservationSource;
};

type Outcome = {
  reservation_id: string;
  asset: string;
  email: string;
  kind: ReminderKind;
  status: "sent" | "failed" | "already_sent" | "skipped_dry_run" | "no_email" | "unclaimed";
  error?: string;
};

function timingSafeStrEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/** See the long note in `/api/cron/time-log-reminder`: this route sends mail on a GET. */
function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  return site === "cross-site" || site === "same-site";
}

async function authorize(
  request: Request,
): Promise<{ ok: true; mode: "cron" | "admin" } | { ok: false; response: NextResponse }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && timingSafeStrEqual(authHeader, `Bearer ${cronSecret}`)) {
    return { ok: true, mode: "cron" };
  }
  const guard = await guardAdmin();
  if (guard.ok) return { ok: true, mode: "admin" };
  return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
}

function appBaseUrl(request: Request): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return new URL(request.url).origin.replace(/\/+$/, "");
}

/** "Th 4 Sep". Uses the module's fixed name table so the label cannot shift with the runtime's ICU data. */
function formatDateLabel(date: string): string {
  try {
    return formatDayLong(date);
  } catch {
    return date;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmail(params: {
  name: string;
  assetName: string;
  assetLabel: string;
  kind: ReminderKind;
  dueDate: string;
  daysLate: number;
  spanLabel: string;
  destination: string | null;
  score: number;
  dashboardUrl: string;
}) {
  const { name, assetName, assetLabel, kind, dueDate, daysLate, spanLabel, destination, score, dashboardUrl } =
    params;

  const due = formatDateLabel(dueDate);
  const subject =
    kind === "due_soon"
      ? `${assetName} is due back tomorrow`
      : kind === "due_today"
        ? `${assetName} is due back today`
        : `${assetName} is ${daysLate} day${daysLate === 1 ? "" : "s"} overdue`;

  const opener =
    kind === "due_soon"
      ? `${assetLabel} is booked to you for ${spanLabel} and is due back ${due}.`
      : kind === "due_today"
        ? `${assetLabel} is due back today (${due}).`
        : `${assetLabel} was due back on ${due} — that is ${daysLate} day${daysLate === 1 ? "" : "s"} ago.`;

  const consequence =
    kind === "overdue"
      ? `While it is out past its due date it counts against your reliability score, which is currently ${score}. The score sets how far ahead you can book and who wins a contested day, so this is worth clearing today.`
      : `Checking it in on time keeps your reliability score (currently ${score}) up, which is what decides how far ahead you can book.`;

  const whereLine = destination ? `Last known location: ${destination}.` : null;

  const text = [
    `Hi ${name},`,
    "",
    opener,
    whereLine,
    "",
    consequence,
    "",
    `Check it in here: ${dashboardUrl}`,
    "",
    "— Flya Allrounder, Fleet",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b1120;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
    <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:14px;padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#38bdf8;">Flyability Fleet</p>
      <h1 style="margin:0 0 18px;font-size:19px;font-weight:600;color:#f8fafc;">${escapeHtml(subject)}</h1>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">${escapeHtml(opener)}</p>
      ${whereLine ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#94a3b8;">${escapeHtml(whereLine)}</p>` : ""}
      <p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#94a3b8;">${escapeHtml(consequence)}</p>
      <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#22d3ee;color:#0b1120;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9px;">Check it in</a>
      <p style="margin:22px 0 0;font-size:12px;color:#64748b;">— Flya Allrounder, Fleet</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const limitResult = await checkRateLimit(`cron-fleet-reminder:${getClientIp(request)}`, {
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limitResult) },
    );
  }

  const url = new URL(request.url);
  const isDryRun = url.searchParams.get("dry") === "1";
  const preview = url.searchParams.get("preview");
  const sendTestTo = url.searchParams.get("send_test")?.trim() ?? "";
  const isPreview = preview === "html" || preview === "text";
  const sendsMail = !isPreview && !isDryRun;

  if (sendsMail && isCrossSiteRequest(request)) {
    return NextResponse.json({ error: "Cross-site invocation refused." }, { status: 403 });
  }

  const today = todayInZurich();
  const admin = createAdminClient();

  // Global hold. Reminders ship switched OFF: the bookings carried over from the
  // spreadsheet have guessed due dates, and mailing people about those on day
  // one teaches everyone to ignore the reminder before it ever carries a real
  // one. An admin turns it on from the Fleet panel once the data is trusted.
  // `?preview=` still renders, so the mail can be reviewed while paused.
  const remindersEnabled = await fetchRemindersEnabled(admin);
  const previewOnly = url.searchParams.get("preview");
  if (!remindersEnabled && previewOnly !== "html" && previewOnly !== "text") {
    return NextResponse.json({
      ok: true,
      skipped: "reminders_disabled",
      today,
      hint: "Turn reminders on in the Fleet panel (admin), or POST /api/fleet {action:'set_reminders',enabled:true}.",
    });
  }

  // Only bookings that can still be late. `returned` and `cancelled` are done.
  const { data: liveRows, error: liveError } = await admin
    .from("fleet_reservations")
    .select("id, asset_id, user_id, holder_label, start_date, end_date, status, destination, returned_on")
    .in("status", ["reserved", "picked_up"]);
  if (liveError) {
    console.error("fleet reminder: reservations read failed", liveError.message);
    return NextResponse.json({ error: "Could not read reservations." }, { status: 500 });
  }
  const live = (liveRows ?? []) as LiveReservation[];

  // Decide who gets what, before touching Resend.
  const due = live
    .map((row) => {
      const span: ReservationSpan = {
        id: row.id,
        asset_id: row.asset_id,
        user_id: row.user_id,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        returned_on: row.returned_on,
        holder_label: row.holder_label,
      };
      return { row, span, kind: reminderFor(span, today) };
    })
    .filter((entry): entry is { row: LiveReservation; span: ReservationSpan; kind: ReminderKind } =>
      entry.kind !== null,
    );

  if (due.length === 0 && !isPreview) {
    return NextResponse.json({ ok: true, today, considered: live.length, due: 0, outcomes: [] });
  }

  // Resolve asset names and recipient emails for just the reservations in play.
  const assetIds = [...new Set(due.map((d) => d.row.asset_id))];
  const { data: assetRows } = await admin
    .from("fleet_assets")
    .select("id, name, model, current_location")
    .in("id", assetIds.length > 0 ? assetIds : ["00000000-0000-0000-0000-000000000000"]);
  const assets = new Map(
    (assetRows ?? []).map((a) => [
      a.id as string,
      { name: a.name as string, model: (a.model as string | null) ?? null, location: (a.current_location as string | null) ?? null },
    ]),
  );

  const { data: userPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const users = new Map(
    (userPage?.users ?? []).map((u) => [
      u.id,
      {
        email: u.email ?? null,
        name: displayNameFor({ email: u.email, identities: u.identities }),
      },
    ]),
  );

  // Reliability is per user, and every mail quotes it — compute once each.
  const allSpansByUser = new Map<string, ReservationSpan[]>();
  const { data: allRows } = await admin
    .from("fleet_reservations")
    .select("id, asset_id, user_id, start_date, end_date, status, returned_on, source");
  for (const row of (allRows ?? []) as ScoringReservation[]) {
    if (!row.user_id) continue;
    const list = allSpansByUser.get(row.user_id) ?? [];
    list.push({
      id: row.id,
      asset_id: row.asset_id,
      user_id: row.user_id,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      returned_on: row.returned_on,
      source: row.source,
    });
    allSpansByUser.set(row.user_id, list);
  }

  const dashboardUrl = `${appBaseUrl(request)}/dashboard?module=fleet`;

  /** Display name for a reservation's holder, account-backed or not. */
  function holderNameOf(row: LiveReservation): string {
    if (row.user_id) return users.get(row.user_id)?.name ?? "there";
    return row.holder_label ?? "there";
  }

  function composeFor(entry: (typeof due)[number], recipientName: string) {
    const asset = assets.get(entry.row.asset_id);
    const assetName = asset?.name ?? "Fleet material";
    const assetLabel = asset?.model ? `${assetName} (${asset.model})` : assetName;
    const score = computeReliability(
      entry.row.user_id ? (allSpansByUser.get(entry.row.user_id) ?? []) : [],
      today,
    ).score;
    return buildEmail({
      name: recipientName,
      assetName,
      assetLabel,
      kind: entry.kind,
      dueDate: dueDateOf(entry.span),
      daysLate: daysOverdue(entry.span, today),
      spanLabel: formatSpan(entry.row.start_date, entry.row.end_date),
      destination: entry.row.destination ?? asset?.location ?? null,
      score,
      dashboardUrl,
    });
  }

  // ?preview — render the first due reminder (or a representative sample) without sending.
  if (isPreview) {
    const sample = due[0];
    const built = sample
      ? composeFor(sample, holderNameOf(sample.row))
      : buildEmail({
          name: "Sample",
          assetName: "E3-SVA-330",
          assetLabel: "E3-SVA-330 (Elios 3)",
          kind: "overdue",
          dueDate: today,
          daysLate: 4,
          spanLabel: formatSpan(today, today),
          destination: "Office Paudex",
          score: 62,
          dashboardUrl,
        });
    return new NextResponse(preview === "html" ? built.html : built.text, {
      headers: { "Content-Type": preview === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" },
    });
  }

  // ?send_test — one real mail to the given address, nothing recorded.
  if (sendTestTo) {
    if (!isResendConfigured()) {
      return NextResponse.json({ error: "Resend is not configured." }, { status: 503 });
    }
    const sample = due[0];
    const built = sample
      ? composeFor(sample, "there")
      : buildEmail({
          name: "there",
          assetName: "E3-SVA-330",
          assetLabel: "E3-SVA-330 (Elios 3)",
          kind: "overdue",
          dueDate: today,
          daysLate: 4,
          spanLabel: formatSpan(today, today),
          destination: "Office Paudex",
          score: 62,
          dashboardUrl,
        });
    const result = await sendEmailViaResend({ to: sendTestTo, ...built });
    return NextResponse.json({ ok: result.ok, test_to: sendTestTo, result });
  }

  if (!isDryRun && !isResendConfigured()) {
    return NextResponse.json({ ok: false, skipped: "resend_not_configured", due: due.length });
  }

  const outcomes: Outcome[] = [];

  for (const entry of due) {
    const assetName = assets.get(entry.row.asset_id)?.name ?? "Fleet material";

    // A booking still filed under a name has nobody to mail. It stays visible on
    // the calendar and in the admin's unclaimed list; chasing it is a person
    // problem, not an email one.
    if (!entry.row.user_id) {
      outcomes.push({
        reservation_id: entry.row.id,
        asset: assetName,
        email: "",
        kind: entry.kind,
        status: "unclaimed",
      });
      continue;
    }

    const recipient = users.get(entry.row.user_id);

    if (!recipient?.email) {
      outcomes.push({
        reservation_id: entry.row.id,
        asset: assetName,
        email: "",
        kind: entry.kind,
        status: "no_email",
      });
      continue;
    }

    if (isDryRun) {
      outcomes.push({
        reservation_id: entry.row.id,
        asset: assetName,
        email: recipient.email,
        kind: entry.kind,
        status: "skipped_dry_run",
      });
      continue;
    }

    // Claim the send BEFORE mailing. The unique index is what makes a retry or a
    // double cron fire safe: losing the insert means somebody already sent this
    // exact reminder today, so we must not send it again.
    const { error: claimError } = await admin.from("fleet_reminder_sends").insert({
      reservation_id: entry.row.id,
      user_id: entry.row.user_id,
      kind: entry.kind,
      sent_for_date: today,
      email: recipient.email,
      status: "sending",
    });
    if (claimError) {
      outcomes.push({
        reservation_id: entry.row.id,
        asset: assetName,
        email: recipient.email,
        kind: entry.kind,
        status: "already_sent",
      });
      continue;
    }

    const built = composeFor(entry, recipient.name);
    const result = await sendEmailViaResend({ to: recipient.email, ...built });

    await admin
      .from("fleet_reminder_sends")
      .update({ status: result.ok ? "sent" : "failed", error: result.ok ? null : result.error })
      .eq("reservation_id", entry.row.id)
      .eq("kind", entry.kind)
      .eq("sent_for_date", today);

    outcomes.push({
      reservation_id: entry.row.id,
      asset: assetName,
      email: recipient.email,
      kind: entry.kind,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? undefined : result.error,
    });
  }

  return NextResponse.json({
    ok: true,
    today,
    mode: auth.mode,
    considered: live.length,
    due: due.length,
    sent: outcomes.filter((o) => o.status === "sent").length,
    outcomes,
  });
}
