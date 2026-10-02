import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  // `next` is attacker-controllable and this route is unauthenticated (it is not
  // in the proxy matcher). Without validation, `?next=https://evil.example`
  // makes us 307 off-origin from a trusted URL — a phishing primitive on our own
  // domain. `new URL(next, origin)` does not prevent that: an absolute or
  // protocol-relative value discards the base entirely.
  const next = safeRedirectPath(requestUrl.searchParams.get("next"));
  let response = NextResponse.redirect(new URL(next, requestUrl.origin));

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.redirect(new URL("/login?error=oauth_failed", requestUrl.origin));
    }
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=oauth_failed", requestUrl.origin));
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = user?.email?.toLowerCase() ?? "";
    // Second layer only. By the time this runs Supabase has already created
    // the account, so the real gate is the Before User Created auth hook
    // (supabase/2026-10-02-restrict-signup-domain.sql), which refuses the
    // sign-up itself. Keep the two domain rules in step.
    if (!email.endsWith("@flyability.com")) {
      response = NextResponse.redirect(new URL("/login?error=domain_not_allowed", requestUrl.origin));
      await supabase.auth.signOut();
      return response;
    }
  }

  return response;
}
