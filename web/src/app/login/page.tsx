"use client";

import { createClient } from "@/lib/supabase/client";
import { m } from "framer-motion";
import { useState } from "react";

export default function LoginPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const authError = new URLSearchParams(window.location.search).get("error");
    if (authError === "domain_not_allowed") return "Only @flyability.com Google accounts are allowed.";
    if (authError === "oauth_failed") return "Google sign-in failed. Please try again.";
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
      <div className="absolute inset-0 aurora-bg" />
      <div className="absolute inset-0 bg-overlay/30 backdrop-blur-xl" />
      <m.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="glass-card hourlogger-surface w-full p-5 md:p-6">
          <div className="mb-7">
            <p className="mb-2 text-xs tracking-[0.22em] text-accent-soft/80 uppercase">Flyability Internal</p>
            <h2 className="text-2xl font-semibold md:text-3xl">Welcome back</h2>
            <p className="mt-2 text-sm text-ink-2/80">
              Continue with your Flyability Google account.
            </p>
          </div>
          <div className="space-y-4">
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

          {message && <p className="mt-4 text-sm text-positive">{message}</p>}
          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </div>
      </m.section>
    </main>
  );
}
