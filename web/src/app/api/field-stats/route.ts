import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { getFieldStats } from "@/lib/field-stats-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Field stats for everyone with a role. Returns the counts plus the entries
// behind them (the activity text of each counted POC/training/travel day) —
// never the rest of the sheet: off days, holds and other cells stay on the server.
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
    const status =
      result.reason === "not_configured" || result.reason === "token_missing" || result.reason === "source_not_admin"
        ? 409
        : 502;
    return NextResponse.json({ error: result.hint, reason: result.reason }, { status });
  }
  return NextResponse.json(
    { stats: result.stats, fetchedAt: result.fetchedAt, stale: result.stale },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
