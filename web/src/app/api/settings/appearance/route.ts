import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { serverError } from "@/lib/api-errors";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isThemeValue } from "@/lib/theme-attrs";

// Persist appearance prefs (theme + accent) to the signed-in user's account so
// the choice survives refreshes, new sessions, and other devices. Stored in
// Supabase user_metadata under `appearance_theme` / `appearance_accent`; read
// back during SSR in the root layout to apply before first paint.
//
// The layout reads them from the access token's claims (getClaims(), no Auth
// round-trip), and `updateUser` does not reissue that token — so without the
// refresh below the JWT in the cookie keeps the *old* appearance for up to an
// hour, every page load SSRs the old skin, and the pre-hydration bootstrap then
// copies that stale value back over localStorage: the choice looks like it
// never saved. Hence this route has its own cookie-writing client (the shared
// lib/supabase/server.ts one is for Server Components, whose cookies are
// read-only) and reissues the session once the metadata is written.

const VALID_ACCENTS = new Set(["amber", "blue"]);

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }
  const cookieStore = await cookies();
  const pending: PendingCookie[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Buffered and attached to the response below: the refreshed
          // session has to reach the browser, or the next SSR still sees the
          // old token.
          cookiesToSet.forEach(({ name, value, options }) => {
            pending.push({ name, value, options: (options ?? {}) as Record<string, unknown> });
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = (body && typeof body === "object" ? body : {}) as {
    theme?: unknown;
    accent?: unknown;
  };

  const patch: Record<string, string> = {};
  if (isThemeValue(input.theme)) {
    patch.appearance_theme = input.theme;
  }
  if (typeof input.accent === "string" && VALID_ACCENTS.has(input.accent)) {
    patch.appearance_accent = input.accent;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid appearance fields" }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ data: patch });
  if (error) {
    return serverError("settings/appearance", error);
  }

  // Reissue the access token so its user_metadata claim carries the new
  // appearance (see the header comment). Best-effort: the metadata is saved
  // either way, and a failed refresh only means the old token lives out its
  // hour, as before.
  try {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) console.warn("[settings/appearance] session refresh failed", refreshError.message);
  } catch (e) {
    console.warn("[settings/appearance] session refresh threw", e);
  }

  const response = NextResponse.json({ ok: true });
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  return response;
}
