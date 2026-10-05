import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { serverError } from "@/lib/api-errors";

// Persist appearance prefs (theme + accent) to the signed-in user's account so
// the choice survives refreshes, new sessions, and other devices. Stored in
// Supabase user_metadata under `appearance_theme` / `appearance_accent`; read
// back during SSR in the root layout to apply before first paint.

const VALID_THEMES = new Set(["dark", "light", "blue"]);
const VALID_ACCENTS = new Set(["amber", "blue"]);

export async function POST(req: Request) {
  const supabase = await createClient();
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
  if (typeof input.theme === "string" && VALID_THEMES.has(input.theme)) {
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
  return NextResponse.json({ ok: true });
}
