"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui";

/** Route-level error boundary for the onboarding segment. */
export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Onboarding segment error", error);
  }, [error]);

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface px-4 py-8 text-ink">
      <div className="absolute inset-0 aurora-bg" />
      <div className="glass-card relative z-10 w-full max-w-md p-8 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-accent-soft/70">Something went wrong</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Onboarding didn&apos;t load</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-4">
          An unexpected error interrupted this page. Retry, or return to your workspace.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="accent" size="lg" onClick={reset}>
            Try again
          </Button>
          <ButtonLink variant="glass" size="lg" href="/dashboard">
            Back to dashboard
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
