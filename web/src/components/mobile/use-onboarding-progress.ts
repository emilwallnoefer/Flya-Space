"use client";

import { useEffect, useState } from "react";

/**
 * The Home tile's view of onboarding: how far along, from the same
 * `/api/onboarding/progress` row the onboarding page keeps. Read-only; the
 * checklist itself lives on /onboarding.
 */
export function useOnboardingProgress() {
  const [summary, setSummary] = useState<{ items: number; average: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding/progress")
      .then((res) => (res.ok ? (res.json() as Promise<{ progress: Record<string, number> }>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const values = Object.values(data.progress ?? {}).filter((v) => typeof v === "number");
        const items = values.length;
        const average = items > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / items) : 0;
        setSummary({ items, average });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return summary;
}
