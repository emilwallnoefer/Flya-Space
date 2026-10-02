import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";

type ProgressRow = {
  progress: Record<string, number> | null;
  started_at: string | null;
  updated_at: string | null;
};

/** Return the signed-in user's onboarding progress (RLS limits this to their own row). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const { data, error } = await supabase
    .from("onboarding_progress")
    .select("progress, started_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data as ProgressRow | null;
  return NextResponse.json({
    progress: row?.progress ?? {},
    started_at: row?.started_at ?? null,
    updated_at: row?.updated_at ?? null,
  });
}

const putBodySchema = z.object({
  // { itemId: percent } — percents are clamped to whole 0..100 below.
  progress: z.record(z.string(), z.number()),
  started_at: z.string().datetime().nullish(),
});

/** Upsert the signed-in user's onboarding progress map. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const parsed = putBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const sanitized: Record<string, number> = {};
  for (const [id, value] of Object.entries(parsed.data.progress)) {
    sanitized[id] = Math.max(0, Math.min(100, Math.round(value)));
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("onboarding_progress").upsert(
    {
      user_id: user.id,
      progress: sanitized,
      started_at: parsed.data.started_at ?? nowIso,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated_at: nowIso });
}
