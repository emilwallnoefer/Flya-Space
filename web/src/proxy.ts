import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { NONCE_HEADER, buildCsp, cspHeaderName, generateCspNonce } from "@/lib/security/csp";
import { REQUEST_URL_HEADER } from "@/lib/launch-route";

/**
 * Paths whose session must be refreshed and gated. Deliberately NOT every path
 * the matcher covers: `updateSession` makes an Auth-server round-trip, and doing
 * that on every API request would add latency to routes that already run their
 * own `getUser()` check. The matcher is wide because the CSP needs to reach every
 * HTML response; the session work stays narrow.
 */
const SESSION_PATHS = ["/dashboard", "/settings", "/login"];

function needsSession(pathname: string): boolean {
  return SESSION_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const nonce = generateCspNonce();
  const csp = buildCsp(nonce);

  // The nonce has to ride on the REQUEST headers, not just the response:
  //   - Next.js parses the request's Content-Security-Policy header, finds the
  //     nonce, and stamps it onto the inline bootstrap scripts it injects itself.
  //   - app/layout.tsx reads `x-nonce` to stamp the theme bootstrap.
  // Without this, dropping 'unsafe-inline' would block Next's own scripts and
  // white-screen the app.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // The path and query, for the root layout (does the launch splash play?)
  // and the dashboard's loading UI (which module's skeleton to draw) — neither
  // can see the URL otherwise (lib/launch-route.ts). `set`, so a client cannot
  // supply its own.
  requestHeaders.set(REQUEST_URL_HEADER, request.nextUrl.pathname + request.nextUrl.search);

  const response = needsSession(request.nextUrl.pathname)
    ? await updateSession(request, requestHeaders)
    : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set(cspHeaderName(), csp);
  return response;
}

export const config = {
  // Everything except static assets, which need no CSP and would only add
  // middleware overhead. Note this is much wider than the old matcher — see
  // `needsSession` for why that does not mean more auth work per request.
  // "/" itself (the `(?!$)`) is excluded too: next.config.ts rewrites it to the
  // static launch page, which must come off the CDN without waking any
  // function, and carries its own static CSP there.
  matcher: [
    {
      source:
        "/((?!$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|txt|xml|webmanifest)$).*)",
    },
  ],
};
