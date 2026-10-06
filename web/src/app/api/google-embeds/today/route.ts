import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { isAdminEmail } from "@/lib/admin";
import { canSeeGoogleEmbeds } from "@/lib/google-embeds";
import { todayCellFor } from "@/lib/google-embed-today";
import { normalizeUserRole } from "@/lib/user-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Today's cell in an embedded sheet (`?sheet=planning|fleet`), for the roles
// that see the embeds. Returns only a cell address like "A3204", or null.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  // Role from app_metadata only (never user_metadata — SECURITY.md T0.1).
  const role = normalizeUserRole((user.app_metadata as Record<string, unknown> | undefined)?.role);
  if (!canSeeGoogleEmbeds(role, isAdminEmail(user.email))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sheet = new URL(request.url).searchParams.get("sheet");
  if (sheet !== "planning" && sheet !== "fleet") {
    return NextResponse.json({ error: "unknown sheet" }, { status: 400 });
  }
  const cell = await todayCellFor(sheet);
  return NextResponse.json({ cell }, { headers: { "Cache-Control": "private, no-store" } });
}
