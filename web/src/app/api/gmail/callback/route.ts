import { exchangeCodeForTokens, getConnectedGmailEmail } from "@/lib/gmail";
import { saveGmailToken } from "@/lib/gmail-tokens";
import { hasAppAccess } from "@/lib/app-access";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/** Redirect while clearing the one-time OAuth state cookie. */
function redirectClearingState(url: URL) {
  const response = NextResponse.redirect(url);
  response.cookies.set("gmail_oauth_state", "", { path: "/", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  // A held account has no module to connect Gmail for: back to the role gate.
  if (!hasAppAccess(user)) return NextResponse.redirect(new URL("/dashboard", request.url));
  if (!code) return redirectClearingState(new URL("/dashboard?gmail=error", request.url));

  // Anti-CSRF: the state echoed by Google must match the cookie set at connect
  // time (SECURITY.md T1.3). Reject if missing or mismatched.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value;
  if (!expectedState || !state || state !== expectedState) {
    return redirectClearingState(new URL("/dashboard?gmail=error", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const connectedGmail =
      (await getConnectedGmailEmail(tokens, redirectUri).catch(() => null)) ||
      String(user.user_metadata?.gmail_email ?? "");

    // The refresh token is a secret and must never touch user_metadata (which
    // is embedded in the client-readable JWT). Store it server-side only.
    if (tokens.refresh_token) {
      await saveGmailToken(user.id, {
        refresh_token: tokens.refresh_token,
        gmail_email: connectedGmail || null,
      });
    }

    // gmail_email is not secret; keep it in user_metadata for display.
    if (connectedGmail) {
      const { error } = await supabase.auth.updateUser({
        data: { ...user.user_metadata, gmail_email: connectedGmail },
      });
      if (error) throw error;
    }
  } catch {
    return redirectClearingState(new URL("/dashboard?gmail=error", request.url));
  }

  return redirectClearingState(new URL("/dashboard?gmail=connected", request.url));
}
