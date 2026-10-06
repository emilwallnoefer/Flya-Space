import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { getFieldStats } from "@/lib/field-stats-sheet";
import { canSeeFieldStatsDetail, withoutDetail } from "@/lib/field-stats";
import { isAdminEmail } from "@/lib/admin";
import { normalizeUserRole } from "@/lib/user-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Field stats for everyone with a role. Pilots and admins also get the entries
// behind the counts (the activity text of each counted POC/training/travel day);
// sales and HR get the counts only. Never the rest of the sheet: off days, holds
// and other cells stay on the server.
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
  // Role from app_metadata only (never user_metadata — SECURITY.md T0.1).
  const role = normalizeUserRole((user.app_metadata as Record<string, unknown> | undefined)?.role);
  const detail = canSeeFieldStatsDetail(role, isAdminEmail(user.email));
  return NextResponse.json(
    { stats: detail ? result.stats : withoutDetail(result.stats), fetchedAt: result.fetchedAt, stale: result.stale },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
