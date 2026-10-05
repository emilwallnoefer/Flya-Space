/**
 * Content-Security-Policy construction.
 *
 * The policy used to live in `next.config.ts`, which can only emit STATIC
 * headers — and a static policy cannot carry a per-request nonce, which is why
 * `script-src` was stuck with `'unsafe-inline'`. `'unsafe-inline'` allows any
 * injected inline `<script>`, so the enforced policy was a good framing and
 * exfiltration control but did almost nothing against XSS.
 *
 * It now lives here and is emitted from `src/proxy.ts` with a fresh nonce per
 * request. See SECURITY.md T1.1 / security audit run-3 H1.
 *
 * WHY NOT `'strict-dynamic'`: with `'self' 'nonce-…'` an injected inline script
 * is already blocked (it has no nonce, and per the CSP spec a policy containing
 * a nonce ignores `'unsafe-inline'` entirely). `'strict-dynamic'` would
 * additionally stop an attacker loading a same-origin script URL, at the cost of
 * making every dynamically-inserted script depend on nonce propagation. That is
 * a worthwhile next step, but it is a behaviour change with real breakage risk
 * and is deliberately not bundled with this one.
 *
 * `style-src` keeps `'unsafe-inline'`: Tailwind and framer-motion both set inline
 * styles, and framer-motion mutates them per animation frame, so nonces are not
 * workable there. Inline style is a far weaker primitive than inline script.
 */

/** Bytes of entropy per nonce. 16 bytes = 128 bits, well beyond guessability. */
const NONCE_BYTES = 16;

/**
 * Generate a per-request nonce. Uses Web Crypto so it works in the edge runtime
 * where middleware executes (`node:crypto` is not available there).
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function supabaseOrigins(): { http: string; wss: string } {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    if (raw) {
      const url = new URL(raw);
      return { http: `${url.protocol}//${url.host}`, wss: `wss://${url.host}` };
    }
  } catch {
    // Malformed env — connect-src falls back to 'self' only.
  }
  return { http: "", wss: "" };
}

/**
 * Build the policy for one request.
 *
 * Vercel injects the Live / Comments toolbar (backed by a Pusher websocket) into
 * *preview* deployments only, so it is allowed there and nowhere else — the
 * production policy stays tight.
 */
export function buildCsp(nonce: string): string {
  const isPreview = process.env.VERCEL_ENV === "preview";
  const { http: supabaseHttp, wss: supabaseWss } = supabaseOrigins();

  const liveScript = isPreview ? ["https://vercel.live", "'unsafe-eval'"] : [];
  const liveStyle = isPreview ? ["https://vercel.live"] : [];
  const liveConnect = isPreview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [];
  const liveFrame = isPreview ? ["https://vercel.live"] : [];
  const liveFont = isPreview ? ["https://vercel.live", "https://assets.vercel.com"] : [];

  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    // The nonce is what lets us drop 'unsafe-inline'. Next.js reads this same
    // header off the REQUEST and stamps the nonce onto its own inline bootstrap
    // scripts; the theme bootstrap in app/layout.tsx reads it from `x-nonce`.
    `script-src ${["'self'", `'nonce-${nonce}'`, ...liveScript].join(" ")}`,
    `style-src ${["'self'", "'unsafe-inline'", ...liveStyle].join(" ")}`,
    // Mail-tracking pixels, Supabase Storage signed URLs, and data/blob QR images
    // (html-to-image renders the day-log card to a blob via a data:-URI SVG).
    `img-src 'self' data: blob: https:`,
    `font-src ${["'self'", "data:", ...liveFont].join(" ")}`,
    // Supabase REST + Realtime are the only browser-side external endpoints;
    // Gmail, Google Sheets and Resend are all called server-side.
    `connect-src ${["'self'", supabaseHttp, supabaseWss, ...liveConnect].filter(Boolean).join(" ")}`,
    // docs.google.com: the Mission planning module frames Google's own sheet
    // editor (lib/mission-planning.ts). accounts.google.com is deliberately
    // absent — Google's sign-in refuses framing anyway; it opens in a new tab.
    `frame-src ${["'self'", "https://docs.google.com", ...liveFrame].join(" ")}`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
  ].join("; ");
}

/**
 * Header name to emit under. Enforcement is flipped by env, not by a code edit,
 * so it can be turned off without a deploy if the policy ever breaks something.
 * `CSP_ENFORCE=1` has been set in Vercel since 2026-07-26.
 */
export function cspHeaderName(): string {
  return process.env.CSP_ENFORCE === "1"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}

/** Request header the root layout reads to stamp the nonce onto its inline script. */
export const NONCE_HEADER = "x-nonce";
