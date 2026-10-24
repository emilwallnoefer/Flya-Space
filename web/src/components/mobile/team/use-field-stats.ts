"use client";

import { useCallback, useEffect, useState } from "react";
import type { FieldStats } from "@/lib/field-stats";

export type FieldStatsLoaded = { stats: FieldStats; fetchedAt: string; stale: boolean };

async function requestFieldStats(): Promise<FieldStatsLoaded> {
  const response = await fetch("/api/field-stats", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as Partial<FieldStatsLoaded> & { error?: string };
  if (!response.ok || !payload.stats) throw new Error(payload.error || "Could not load the field stats.");
  return payload as FieldStatsLoaded;
}

/**
 * Field stats for the phone: the same `/api/field-stats` read the desktop
 * panel does (the server caches it for 10 minutes). `enabled` lets the Home
 * card wait until it is on screen.
 */
export function useFieldStats(enabled: boolean) {
  const [data, setData] = useState<FieldStatsLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The effect below may not set state itself, so the loading state is set up
  // front: at mount, and during render when `enabled` turns on.
  const [loading, setLoading] = useState(enabled);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (enabled) {
      setLoading(true);
      setError(null);
    }
  }

  const fetchStats = useCallback(
    () =>
      requestFieldStats()
        .then(setData, (err: Error) => setError(err.message || "Could not load the field stats."))
        .finally(() => setLoading(false)),
    [],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!enabled) return;
    void fetchStats();
  }, [enabled, fetchStats]);

  return { data, stats: data?.stats ?? null, error, loading, reload: load };
}
