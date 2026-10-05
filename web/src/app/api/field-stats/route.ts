import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { getFieldStats } from "@/lib/field-stats-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Field stats for everyone with a role. Only aggregated counts leave the
// server — never the sheet's cells.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const result = await getFieldStats();
  if (!result.ok) {
    const status = result.reason === "not_configured" || result.reason === "token_missing" ? 409 : 502;
    return NextResponse.json({ error: result.hint, reason: result.reason }, { status });
  }
  return NextResponse.json(
    { stats: result.stats, fetchedAt: result.fetchedAt, stale: result.stale },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
