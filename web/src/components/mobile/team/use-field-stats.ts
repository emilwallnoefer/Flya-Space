"use client";

import { useCallback, useEffect, useState } from "react";
import type { FieldStats } from "@/lib/field-stats";

export type FieldStatsLoaded = { stats: FieldStats; fetchedAt: string; stale: boolean };

/**
 * Field stats for the phone: the same `/api/field-stats` read the desktop
 * panel does (the server caches it for 10 minutes). `enabled` lets the Home
 * card wait until it is on screen.
 */
export function useFieldStats(enabled: boolean) {
  const [data, setData] = useState<FieldStatsLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/field-stats", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Partial<FieldStatsLoaded> & { error?: string };
      if (!response.ok || !payload.stats) throw new Error(payload.error || "Could not load the field stats.");
      setData(payload as FieldStatsLoaded);
    } catch (err) {
      setError((err as Error).message || "Could not load the field stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { data, stats: data?.stats ?? null, error, loading, reload: load };
}
