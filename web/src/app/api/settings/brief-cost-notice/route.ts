import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";

/**
 * Marks the one-time AI brief cost note as seen for this user, so it never
 * shows again on any device. Stored in Supabase user_metadata under
 * `brief_cost_notice_seen` (a courtesy flag — it grants nothing); read back
 * through GET /api/settings/mail-generation.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  // updateUser merges top-level metadata keys, so only the flag is sent.
  const { error } = await supabase.auth.updateUser({ data: { brief_cost_notice_seen: true } });
  if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
