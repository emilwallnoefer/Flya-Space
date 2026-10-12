"use client";

import { createClient } from "@/lib/supabase/client";
import { m } from "framer-motion";
import { useEffect, useState, type CSSProperties } from "react";
import { markLaunchReady } from "@/lib/launch-ready";
import { NAVBAR_TITLE, NAVBAR_TITLE_CLASS } from "@/components/workspace-home-layout";

/** True when the page runs as a home-screen app (iOS `navigator.standalone`, or the manifest's display mode elsewhere). */
function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export default function LoginPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const [loading, setLoading] = useState(false);

  // The page is on screen: the launch camera may pull back now.
  useEffect(() => {
    markLaunchReady();
  }, []);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const authError = new URLSearchParams(window.location.search).get("error");
    if (authError === "domain_not_allowed") return "Only @flyability.com Google accounts are allowed.";
    if (authError === "oauth_failed") {
      // Installed on an iPhone home screen: the first sign-in sometimes
      // completes in Safari's in-app sheet instead of the app window. A
      // second tap, now from inside the app, goes through.
      return isStandaloneApp()
        ? "Sign-in didn't finish inside the app. Tap Continue with Google once more."
        : "Google sign-in failed. Please try again.";
    }
    return null;
  });

  async function handleGoogleSignIn() {
    if (!supabaseConfigured) {
      setError("Missing Supabase env vars in deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    setLoading(true);
    setMessage(null);
    setError(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/dashboard`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          hd: "flyability.com",
          prompt: "select_account",
        },
      },
    });
    if (oauthError) {
      const lower = oauthError.message.toLowerCase();
      if (lower.includes("provider is not enabled")) {
        setError(
          "Google sign-in is not enabled in Supabase yet. Enable Google under Authentication > Providers and add Google OAuth client credentials.",
        );
      } else {
        setError(oauthError.message);
      }
      setLoading(false);
      return;
    }
  }

  return (
    <main id="main-content" className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface px-4 py-8 text-ink">
      {/* Background decoration: in with the launch camera, so the opening
          frame is the title on the plain page colour. */}
      <div className="absolute inset-0 aurora-bg" data-launch-reveal="surface" style={{ "--reveal-i": 0 } as CSSProperties} />
      <div className="absolute inset-0 bg-overlay/30 backdrop-blur-xl" data-launch-reveal="surface" style={{ "--reveal-i": 0 } as CSSProperties} />
      <m.section
        // No entrance of its own: the launch camera is the entrance, and it
        // measures the title while this would still be moving.
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="relative isolate w-full p-5 md:p-6">
          {/* The card itself; a launch reveal so the title can stand alone first. */}
          <div className="glass-card hourlogger-surface absolute! inset-0 -z-1" data-launch-reveal="surface" style={{ "--reveal-i": 0 } as CSSProperties} aria-hidden />
          <div className="mb-7">
            {/* The launch camera's target: the splash title is this, zoomed in. */}
            <p className={`${NAVBAR_TITLE_CLASS} mb-2`} data-launch-target>{NAVBAR_TITLE}</p>
            <h2 className="text-2xl font-semibold md:text-3xl" data-launch-reveal style={{ "--reveal-i": 1 } as CSSProperties}>Welcome back</h2>
            <p className="mt-2 text-sm text-ink-2/80" data-launch-reveal style={{ "--reveal-i": 2 } as CSSProperties}>
              Continue with your Flyability Google account.
            </p>
          </div>
          <div className="space-y-4" data-launch-reveal style={{ "--reveal-i": 3 } as CSSProperties}>
            {!supabaseConfigured && (
              <p className="rounded-lg border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-xs text-danger">
                Supabase is not configured for this deployment. Add `NEXT_PUBLIC_SUPABASE_URL` and
                `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel and redeploy.
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                void handleGoogleSignIn();
              }}
              disabled={loading || !supabaseConfigured}
              className="h-12 w-full rounded-xl bg-accent/90 text-sm font-semibold text-slate-950 transition hover:bg-accent disabled:opacity-70"
            >
              {loading ? "Redirecting…" : "Continue with Google"}
            </button>
          </div>

          {message && <p className="mt-4 text-sm text-positive" data-launch-reveal style={{ "--reveal-i": 3 } as CSSProperties}>{message}</p>}
          {error && <p className="mt-4 text-sm text-danger" data-launch-reveal style={{ "--reveal-i": 3 } as CSSProperties}>{error}</p>}
        </div>
      </m.section>
    </main>
  );
}
