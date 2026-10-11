import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { serverError } from "@/lib/api-errors";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { isPushConfigured } from "@/lib/push/send";

/**
 * A device opting in to (or out of) phone notifications.
 *
 * POST   {subscription: PushSubscriptionJSON}  — upsert this device for the
 *        signed-in user. The endpoint is unique across users: a device that was
 *        subscribed under another account on this browser moves to the new one.
 * DELETE {endpoint}                            — forget this device.
 * GET    ?endpoint=…                           — is this device registered for me?
 *        The browser knows it has a subscription; this answers whether we do.
 *
 * Writes go through the user's own session (RLS: own rows, role required), so
 * the service role never touches this table from the request path.
 */

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048).startsWith("https://"),
    keys: z.object({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(128),
    }),
  }),
});

const deleteSchema = z.object({
  endpoint: z.string().url().max(2048).startsWith("https://"),
});

async function requireUser(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const held = forbidHeldAccount(user);
  if (held) return { error: held } as const;
  const limit = await checkRateLimit(`push-subscription:${user.id}:${getClientIp(request)}`, {
    windowMs: 60 * 60 * 1000,
    max: 60,
  });
  if (!limit.allowed) {
    return {
      error: NextResponse.json(
        { error: "Rate limit exceeded. Please retry later." },
        { status: 429, headers: createRateLimitHeaders(limit) },
      ),
    } as const;
  }
  return { supabase, user } as const;
}

export async function GET(request: Request) {
  const ctx = await requireUser(request);
  if ("error" in ctx) return ctx.error;
  const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
  if (!endpoint) {
    return NextResponse.json({ configured: isPushConfigured(), registered: false });
  }
  const { data, error } = await ctx.supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) return serverError("push/subscription GET", error);
  return NextResponse.json({ configured: isPushConfigured(), registered: Boolean(data) });
}

export async function POST(request: Request) {
  const ctx = await requireUser(request);
  if ("error" in ctx) return ctx.error;
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Notifications are not set up on this server." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = subscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  const { endpoint, keys } = parsed.data.subscription;
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;

  // The endpoint is unique. Re-subscribing from the same device just refreshes
  // our row. If this browser was last subscribed under ANOTHER account, the
  // conflicting row is not ours: RLS refuses the update (42501), and we answer
  // 409 rather than silently moving a device between people. The client then
  // drops that browser subscription and mints a fresh endpoint (see
  // `lib/push/client.ts`); the old row dies on its first 410 from the cron.
  const { error: insertError } = await ctx.supabase.from("push_subscriptions").upsert(
    {
      user_id: ctx.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (insertError) {
    if (insertError.code === "23505" || insertError.code === "42501") {
      return NextResponse.json(
        { error: "This device is registered to another account. Sign out there first." },
        { status: 409 },
      );
    }
    return serverError("push/subscription POST", insertError);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const ctx = await requireUser(request);
  if ("error" in ctx) return ctx.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint." }, { status: 400 });
  }
  const { error } = await ctx.supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", ctx.user.id)
    .eq("endpoint", parsed.data.endpoint);
  if (error) return serverError("push/subscription DELETE", error);
  return NextResponse.json({ ok: true });
}
