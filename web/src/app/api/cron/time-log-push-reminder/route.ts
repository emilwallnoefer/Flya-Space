import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardAdmin } from "@/lib/admin-guard";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/api-errors";
import { normalizeUserRole } from "@/lib/user-role";
import { displayNameFor } from "@/lib/fleet-queries";
import { isPushConfigured, type PushSubscriptionRow } from "@/lib/push/send";
import { pushToDevices } from "@/lib/push/notify-users";
import {
  WEEK_UNLOGGED_KIND,
  hasLoggedAnyDay,
  isReminderWindow,
  weekUnloggedPayload,
  workWeekOf,
  zurichParts,
  type DayLogRow,
} from "@/lib/push/week-unlogged";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Friday 19:00 (Europe/Zurich): a phone notification to everyone who switched
 * notifications on and has not logged a single day of the current week.
 *
 * Vercel Cron fires this at 17:00 and 18:00 UTC every Friday (`web/vercel.json`);
 * the route itself gates to the hour that is 19:00 in Zurich, so exactly one
 * of the two runs acts across DST. Only people with a push subscription are
 * considered: the subscription IS the opt-in, so there is no role list here
 * beyond "has a role at all" (a held account cannot subscribe either).
 *
 * "Logged a day" is defined in `lib/push/week-unlogged.ts`: worked minutes, or
 * vacation / public holiday / sick leave, or a comp adjustment this week.
 *
 * Once per user per week: the cron claims a `push_reminder_sends` row before
 * sending, and the unique index refuses a second claim, so a retry or a
 * double-fired cron cannot ping the same phone twice.
 *
 * Auth as the other crons: `Authorization: Bearer $CRON_SECRET`, or an admin
 * session. `?dry=1` lists who would be reminded without sending or claiming;
 * `?force=1` ignores the time window; `?send_test=1` sends the reminder to
 * the calling admin's own devices, whatever the week looks like, with a
 * `[TEST]` prefix — add `&real=1` to see it exactly as recipients will.
 */

type Outcome = {
  user_id: string;
  status: "sent" | "already_sent" | "no_devices_left" | "skipped_dry_run" | "failed";
  devices: number;
  sent: number;
  gone: number;
  failed: number;
};

function timingSafeStrEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  return site === "cross-site" || site === "same-site";
}

async function authorize(
  request: Request,
): Promise<{ ok: true; mode: "cron" | "admin"; adminUserId: string | null } | { ok: false; response: NextResponse }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && timingSafeStrEqual(authHeader, `Bearer ${cronSecret}`)) {
    return { ok: true, mode: "cron", adminUserId: null };
  }
  const guard = await guardAdmin();
  if (guard.ok) return { ok: true, mode: "admin", adminUserId: guard.user.id };
  return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
}

type SubscriptionRow = PushSubscriptionRow & { id: string; user_id: string };

/** Sends to every device of one user; prunes the ones the push service says are gone. */
async function notifyUser(
  admin: SupabaseClient,
  devices: SubscriptionRow[],
  payload: ReturnType<typeof weekUnloggedPayload>,
): Promise<{ sent: number; gone: number; failed: number }> {
  const result = await pushToDevices(admin, devices, payload);
  for (const error of result.errors) {
    console.warn("[push-reminder] send failed", { user: devices[0]?.user_id, error });
  }
  return { sent: result.sent, gone: result.gone, failed: result.failed };
}

type AuthUser = NonNullable<Awaited<ReturnType<SupabaseClient["auth"]["admin"]["getUserById"]>>["data"]["user"]>;

/** First name from the sign-in provider's identity data, via the shared helper. */
function firstNameOf(user: AuthUser): string | null {
  const full = displayNameFor(user);
  if (!full || full === "Unknown") return null;
  return full.split(/\s+/)[0] ?? null;
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const limitResult = await checkRateLimit(`cron-push-reminder:${getClientIp(request)}`, {
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
  const isForced = url.searchParams.get("force") === "1";
  const isSendTest = url.searchParams.get("send_test") === "1";
  const testLooksReal = url.searchParams.get("real") === "1";

  if (!isDryRun && isCrossSiteRequest(request)) {
    return NextResponse.json({ error: "Cross-site invocation refused for a sending request." }, { status: 403 });
  }

  const now = new Date();
  const zurich = zurichParts(now);
  const zurichLabel = `${zurich.weekday} ${String(zurich.hour).padStart(2, "0")}:${String(zurich.minute).padStart(2, "0")}`;

  if (!isPushConfigured() && !isDryRun) {
    return NextResponse.json({ ok: false, skipped: true, reason: "push_not_configured" }, { status: 503 });
  }

  const admin = createAdminClient();

  // An admin checking that their own phone rings: no week check, no claim.
  if (isSendTest) {
    if (auth.mode !== "admin" || !auth.adminUserId) {
      return NextResponse.json({ error: "send_test needs an admin session." }, { status: 400 });
    }
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("user_id", auth.adminUserId);
    if (error) return serverError("cron/time-log-push-reminder", error);
    const devices = (data ?? []) as SubscriptionRow[];
    if (devices.length === 0) {
      return NextResponse.json({ ok: false, error: "No device of yours has notifications switched on." }, { status: 404 });
    }
    const { data: me } = await admin.auth.admin.getUserById(auth.adminUserId);
    const payload = weekUnloggedPayload(me?.user ? firstNameOf(me.user) : null);
    const result = await notifyUser(
      admin,
      devices,
      testLooksReal ? payload : { ...payload, title: `[TEST] ${payload.title}`, tag: `${payload.tag}_test` },
    );
    return NextResponse.json({ ok: result.sent > 0, test: true, devices: devices.length, ...result });
  }

  if (!isForced && !isReminderWindow(zurich)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "outside_window", zurich_time: zurichLabel });
  }

  const week = workWeekOf(zurich.date);

  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth");
  if (subsError) return serverError("cron/time-log-push-reminder", subsError);

  const byUser = new Map<string, SubscriptionRow[]>();
  for (const row of (subs ?? []) as SubscriptionRow[]) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  const outcomes: Outcome[] = [];
  const scanErrors: Array<{ user_id: string; error: string }> = [];
  let considered = 0;

  for (const [userId, devices] of byUser) {
    try {
      // A subscription whose owner lost their role since stays silent.
      const { data: userData } = await admin.auth.admin.getUserById(userId);
      const owner = userData?.user ?? null;
      const role = normalizeUserRole((owner?.app_metadata as Record<string, unknown> | undefined)?.role);
      // Sales and HR have no Time Tracker (lib/role-access.ts).
      if (!owner || !role || role === "hr" || role === "sales") continue;
      considered += 1;

      const [{ data: days, error: daysError }, { count: compCount, error: compError }] = await Promise.all([
        admin
          .from("time_day_logs")
          .select("net_mins, holiday, public_holiday, sick_leave")
          .eq("user_id", userId)
          .gte("work_date", week.start)
          .lte("work_date", week.end),
        admin
          .from("time_comp_adjustments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("work_date", week.start)
          .lte("work_date", week.end),
      ]);
      if (daysError) throw new Error(daysError.message);
      if (compError) throw new Error(compError.message);
      if (hasLoggedAnyDay((days ?? []) as DayLogRow[], compCount ?? 0)) continue;

      if (isDryRun) {
        outcomes.push({ user_id: userId, status: "skipped_dry_run", devices: devices.length, sent: 0, gone: 0, failed: 0 });
        continue;
      }

      // Claim first; a duplicate key means another run already did this week.
      const { error: claimError } = await admin.from("push_reminder_sends").insert({
        user_id: userId,
        kind: WEEK_UNLOGGED_KIND,
        week_start: week.start,
        mode: auth.mode,
        forced: isForced,
      });
      if (claimError) {
        if (claimError.code === "23505") {
          outcomes.push({ user_id: userId, status: "already_sent", devices: devices.length, sent: 0, gone: 0, failed: 0 });
          continue;
        }
        throw new Error(claimError.message);
      }

      const result = await notifyUser(admin, devices, weekUnloggedPayload(firstNameOf(owner)));
      await admin
        .from("push_reminder_sends")
        .update({ sent_count: result.sent, gone_count: result.gone, failed_count: result.failed })
        .eq("user_id", userId)
        .eq("kind", WEEK_UNLOGGED_KIND)
        .eq("week_start", week.start);
      outcomes.push({
        user_id: userId,
        status: result.sent > 0 ? "sent" : result.gone === devices.length ? "no_devices_left" : "failed",
        devices: devices.length,
        ...result,
      });
    } catch (error) {
      scanErrors.push({ user_id: userId, error: (error as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: auth.mode,
    dry_run: isDryRun,
    forced: isForced,
    zurich_time: zurichLabel,
    week,
    subscribed_users: byUser.size,
    considered,
    reminded: outcomes.filter((o) => o.status === "sent" || o.status === "skipped_dry_run").length,
    outcomes,
    scan_errors: scanErrors,
  });
}
