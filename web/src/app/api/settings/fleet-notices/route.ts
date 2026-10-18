import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";

/**
 * Settings → Notifications → "Fleet notices": whether this person is told
 * about bookings that touch theirs (a unit that has not come back, an
 * extension request or its answer, a waitlist spot, an early return).
 *
 * Stored in Supabase user_metadata under `fleet_notices`. A preference, not
 * a privilege — it decides what reaches the person, never what they may do —
 * so user_metadata is the right home (see CLAUDE.md on the line between the
 * two). Default ON: absent means on; only an explicit `false` turns it off.
 * `lib/fleet-queries.ts#fetchUserContacts` reads it before every notice.
 */

const bodySchema = z.object({ enabled: z.boolean() });

function readEnabled(rawMetadata: unknown): boolean {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) return true;
  return (rawMetadata as Record<string, unknown>).fleet_notices !== false;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  return NextResponse.json({ enabled: readEnabled(user.user_metadata) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { enabled: boolean }." }, { status: 400 });

  const previous =
    user.user_metadata && typeof user.user_metadata === "object" && !Array.isArray(user.user_metadata)
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  const { error } = await supabase.auth.updateUser({ data: { ...previous, fleet_notices: parsed.data.enabled } });
  if (error) return NextResponse.json({ error: "Could not save the preference." }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
}
