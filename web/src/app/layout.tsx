import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { MotionProvider } from "@/components/motion-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { NONCE_HEADER } from "@/lib/security/csp";
import { isThemeValue, THEME_COLORS, themeAttributes, type ThemeValue } from "@/lib/theme-attrs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flya Space",
  description: "Flyability internal allround workspace for mail automation and time tracking.",
};

// Browser-chrome tint follows the account's saved skin (each skin's page-bg
// token, listed in lib/theme-attrs.ts).
export async function generateViewport(): Promise<Viewport> {
  const { theme } = await resolveServerAppearance();
  return {
    themeColor: THEME_COLORS[theme ?? "dark"],
  };
}

// Pre-hydration fallback for signed-out pages (and signed-in users who never saved
// a preference): read the device-local cache and apply before first paint so light
// users don't flash dark. When the server already applied the account preference
// (data-appearance-source="server"), this instead syncs the localStorage cache to
// the server truth so the two never drift. The theme → attribute mapping is
// themeAttributes() from lib/theme-attrs.ts, hand-inlined: keep the two in step.
const themeBootstrapScript = `try{var d=document.documentElement;if(d.getAttribute("data-appearance-source")==="server"){var m=d.dataset.mode,t=m==="glass"?"glass":d.dataset.theme==="light"?(m==="blue"||m==="neu"?m:"light"):"dark";localStorage.setItem("ma_theme",t);if(d.dataset.accent)localStorage.setItem("ma_accent_light",d.dataset.accent);}else{var s=localStorage.getItem("ma_theme");if(s==="glacier"||s==="sky")s="blue";if(s==="light"){d.dataset.theme="light";}else if(s==="blue"||s==="neu"){d.dataset.theme="light";d.dataset.mode=s;}else if(s==="glass"){d.dataset.mode="glass";}var a=localStorage.getItem("ma_accent_light");d.dataset.accent=(a==="blue")?"blue":"amber";}}catch(e){}`;

type Appearance = { theme: ThemeValue | null; accent: "amber" | "blue" };

// Resolve the signed-in user's saved appearance from the JWT claims (no Auth-server
// round-trip — middleware already validated the session for this request).
async function resolveServerAppearance(): Promise<Appearance> {
  const fallback: Appearance = { theme: null, accent: "amber" };
  if (!isSupabaseConfigured()) return fallback;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const meta = data?.claims?.user_metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return fallback;
    const m = meta as Record<string, unknown>;
    const t = m.appearance_theme;
    const a = m.appearance_accent;
    return {
      theme: isThemeValue(t) ? t : null,
      accent: a === "blue" ? "blue" : "amber",
    };
  } catch (error) {
    // Non-blocking: fall back to the device-local bootstrap (no server theme).
    console.error("RootLayout: resolveServerAppearance failed", error);
    return fallback;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { theme, accent } = await resolveServerAppearance();

  // Per-request CSP nonce, set by src/proxy.ts. Without it the inline theme
  // bootstrap below is blocked, because script-src no longer allows
  // 'unsafe-inline'. Null only if middleware did not run (it always does for
  // HTML routes) — the script is then simply omitted rather than emitted in a
  // form the browser would refuse.
  const nonce = (await headers()).get(NONCE_HEADER);

  // When the account has a saved theme, apply it as data-* on <html> at SSR time
  // (authoritative, no flash) and flag the source so the bootstrap reconciles
  // localStorage instead of overriding. Otherwise leave it to the bootstrap.
  const htmlProps: Record<string, string> = { lang: "en" };
  if (theme) {
    htmlProps["data-appearance-source"] = "server";
    htmlProps["data-accent"] = accent;
    // dark = absence of data-theme/data-mode
    const attrs = themeAttributes(theme);
    if (attrs.theme) htmlProps["data-theme"] = attrs.theme;
    if (attrs.mode) htmlProps["data-mode"] = attrs.mode;
  }

  return (
    <html {...htmlProps} suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning: after parsing, browsers blank out the `nonce`
          *content attribute* (keeping the value only on the internal slot) so a
          CSS attribute selector cannot exfiltrate it. React's hydration check
          reads the blanked attribute, sees "" against the SSR'd value, and logs
          a mismatch it explicitly says it "won't patch up". Dev-only noise; the
          script still runs with the correct nonce.
        */}
        {nonce ? (
          <script
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
          />
        ) : null}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
