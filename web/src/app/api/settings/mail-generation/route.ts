import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { forbidHeldAccount, forbidWithoutModule } from "@/lib/app-access";

/**
 * Persists which mail generator the composer uses:
 *   "guided" — the deterministic structured selection form (default).
 *   "brief"  — the AI generator (Opus 4.8) driven by a free-text brief.
 * Stored in Supabase user_metadata under `mail_generation_mode`.
 */

const bodySchema = z.object({
  mode: z.enum(["guided", "brief"]),
});

function readModeFromMetadata(rawMetadata: unknown): "guided" | "brief" {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) return "guided";
  const raw = (rawMetadata as Record<string, unknown>).mail_generation_mode;
  return raw === "brief" ? "brief" : "guided";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  const noModule = forbidWithoutModule(user, "mail");
  if (noModule) return noModule;
  return NextResponse.json({
    mode: readModeFromMetadata(user.user_metadata),
    // The one-time AI brief cost note; set by POST /api/settings/brief-cost-notice.
    briefCostNoticeSeen: user.user_metadata?.brief_cost_notice_seen === true,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  const noModule = forbidWithoutModule(user, "mail");
  if (noModule) return noModule;

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mail generation mode." }, { status: 400 });
  }

  const previousMetadata =
    user.user_metadata && typeof user.user_metadata === "object" && !Array.isArray(user.user_metadata)
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  const mergedMetadata = {
    ...previousMetadata,
    mail_generation_mode: parsed.data.mode,
  };

  const { error } = await supabase.auth.updateUser({ data: mergedMetadata });
  if (error) return NextResponse.json({ error: "Could not save mail generation mode." }, { status: 500 });

  return NextResponse.json({ ok: true, mode: parsed.data.mode });
}
