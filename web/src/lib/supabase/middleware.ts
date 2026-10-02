import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { roleInAccessToken } from "@/lib/app-access";

/**
 * @param requestHeaders headers to forward to the app (carries the CSP nonce set
 *   by `proxy.ts`). Must be threaded through every `NextResponse.next()` here, or
 *   the nonce is lost and Next cannot stamp its inline scripts.
 */
export async function updateSession(request: NextRequest, requestHeaders?: Headers) {
  const nextRequest = requestHeaders ? { headers: requestHeaders } : request;
  let response = NextResponse.next({ request: nextRequest });
  try {
    if (!isSupabaseConfigured()) {
      // Let public pages load with a clear UI; avoid hard middleware crashes.
      return response;
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            response = NextResponse.next({ request: nextRequest });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The database reads the role from the access token (`public.has_app_role()`
    // uses auth.jwt()), but `getUser()` above reads it fresh. When an admin has
    // just assigned or removed a role, the two disagree until the token is
    // reissued — up to an hour, during which a newly approved colleague would
    // see the dashboard but an empty team chat. Reissue it now instead. The
    // decode is unverified on purpose: it only decides whether to refresh.
    if (user) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const freshRole = typeof user.app_metadata?.role === "string" ? user.app_metadata.role : null;
      if (session && roleInAccessToken(session.access_token) !== (freshRole || null)) {
        await supabase.auth.refreshSession();
      }
    }

    if (
      !user &&
      (request.nextUrl.pathname.startsWith("/dashboard") || request.nextUrl.pathname.startsWith("/settings"))
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    if (user && request.nextUrl.pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    return response;
  } catch {
    // Fail closed on protected routes (SECURITY.md T1.5): if the session can't
    // be verified, don't let a gated page render — send to login. Public pages
    // still load normally.
    const path = request.nextUrl.pathname;
    if (path.startsWith("/dashboard") || path.startsWith("/settings")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request: nextRequest });
  }
}
