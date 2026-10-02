import { randomBytes } from "node:crypto";
import { getAuthUrl } from "@/lib/gmail";
import { hasAppAccess } from "@/lib/app-access";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  // A held account has no module to connect Gmail for: back to the role gate.
  if (!hasAppAccess(user)) return NextResponse.redirect(new URL("/dashboard", request.url));

  // Anti-CSRF state: a random value carried through the OAuth round-trip in an
  // HttpOnly cookie and matched in the callback (SECURITY.md T1.3), so an
  // attacker cannot bind their own Google account to the victim's session.
  const state = randomBytes(16).toString("hex");
  const authUrl = getAuthUrl(process.env.GOOGLE_OAUTH_REDIRECT_URI || "", state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete the consent flow
  });
  return response;
}
