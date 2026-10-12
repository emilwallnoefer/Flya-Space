import type { NextConfig } from "next";

// NOTE: the CSP is deliberately NOT here any more.
//
// `headers()` can only emit static values, and a static policy cannot carry a
// per-request nonce — which is why `script-src` was stuck with 'unsafe-inline',
// allowing any injected inline <script>. The policy now lives in
// `src/lib/security/csp.ts` and is emitted per request from `src/proxy.ts`,
// which is what let 'unsafe-inline' go. Do not re-add it here: two CSP headers
// are intersected by the browser and the interaction is easy to get wrong.
const securityHeaders = [
  // `preload` makes the domain eligible for the browser-baked HSTS preload list
  // (submit at hstspreload.org). Only meaningful once every subdomain is
  // HTTPS-only — which is the case here; the app is Vercel-hosted and Supabase
  // is a separate domain.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// The launch page at "/" (public/launch.html) is the one route the proxy does
// not cover (see its matcher), so it gets a static policy here. It loads one
// same-origin script and two same-origin fonts and fetches nothing else; the
// policy says exactly that. No nonce is needed because nothing is inline.
const launchPageCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  env: {
    // Versions the offline service worker (public/sw.js): a new value is a new
    // script URL, so every deploy re-caches the offline page against its own
    // chunks. Build time is the fallback off Vercel, so local builds differ too.
    NEXT_PUBLIC_APP_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()),
  },
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // Apply to every route (pages, API, and the /r redirector).
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/",
        headers: [{ key: "Content-Security-Policy", value: launchPageCsp }],
      },
    ];
  },
  async rewrites() {
    return {
      // "/" is the launch page: a static file, served from the CDN the moment
      // the app is opened, which then moves on to /dashboard (or /login via
      // the proxy). `beforeFiles` so it wins over any route for "/".
      beforeFiles: [{ source: "/", destination: "/launch.html" }],
    };
  },
};

export default nextConfig;
