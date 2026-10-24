"use client";

import { useCallback, useRef, useState } from "react";
import {
  addDays,
  getMonday,
  PREFETCH_IDLE_FALLBACK_MS,
  PREFETCH_WEEKS_EACH_SIDE,
  toDateKey,
  type WeekResponse,
} from "../types";

/**
 * Week fetching concern: the per-week response cache, in-flight request
 * de-duplication, and the idle-time prefetch of neighbouring weeks. The caches
 * are exposed so callers can invalidate them wholesale (JSON import, travel
 * mapping change) — single-day edits keep their caches in step instead.
 */
export function useWeekCache(apiBase: string | undefined, initialWeek?: WeekResponse | null) {
  // Seeded once with the server-prefetched week, on the first render only.
  const [seededCache] = useState(
    () => new Map<string, WeekResponse>(initialWeek ? [[initialWeek.week_start, initialWeek]] : []),
  );
  const weekCacheRef = useRef<Map<string, WeekResponse>>(seededCache);
  const weekInflightRef = useRef<Map<string, Promise<WeekResponse>>>(new Map());

  const fetchWeekData = useCallback(
    async (
      targetWeekStart: string,
      options?: { force?: boolean; includeTravel?: boolean },
    ): Promise<WeekResponse> => {
      const force = options?.force ?? false;
      const includeTravel = options?.includeTravel ?? true;
      if (!force) {
        const cached = weekCacheRef.current.get(targetWeekStart);
        if (cached) return cached;
        const inflight = weekInflightRef.current.get(targetWeekStart);
        if (inflight) return inflight;
      }

      const requestPromise = (async () => {
        const base = apiBase ?? "/api/time-tracker";
        const separator = base.includes("?") ? "&" : "?";
        const url = `${base}${separator}weekStart=${encodeURIComponent(targetWeekStart)}&includeTravel=${includeTravel ? "1" : "0"}`;
        const response = await fetch(url);
        const payload = (await response.json()) as WeekResponse | { error: string };
        if (!response.ok) throw new Error((payload as { error: string }).error || "Failed to load tracker");
        const weekData = payload as WeekResponse;
        weekCacheRef.current.set(targetWeekStart, weekData);
        return weekData;
      })();

      weekInflightRef.current.set(targetWeekStart, requestPromise);
      try {
        return await requestPromise;
      } finally {
        weekInflightRef.current.delete(targetWeekStart);
      }
    },
    [apiBase],
  );

  const prefetchNearbyWeeks = useCallback(
    (centerWeekStart: string) => {
      const runPrefetch = () => {
        const center = getMonday(centerWeekStart);
        for (let i = -PREFETCH_WEEKS_EACH_SIDE; i <= PREFETCH_WEEKS_EACH_SIDE; i += 1) {
          if (i === 0) continue;
          const key = toDateKey(addDays(center, i * 7));
          if (weekCacheRef.current.has(key) || weekInflightRef.current.has(key)) continue;
          void fetchWeekData(key, { includeTravel: false }).catch(() => {
            // Silent prefetch failures should not interrupt UI interactions.
          });
        }
      };

      if (typeof window === "undefined") return;
      const idle = (
        window as typeof window & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
        }
      ).requestIdleCallback;
      if (typeof idle === "function") {
        idle(runPrefetch, { timeout: PREFETCH_IDLE_FALLBACK_MS * 2 });
      } else {
        window.setTimeout(runPrefetch, PREFETCH_IDLE_FALLBACK_MS);
      }
    },
    [fetchWeekData],
  );

  /** Drop every cached/in-flight week (used when a write invalidates all of them). */
  const clearWeekCaches = useCallback(() => {
    weekCacheRef.current.clear();
    weekInflightRef.current.clear();
  }, []);

  return { weekCacheRef, fetchWeekData, prefetchNearbyWeeks, clearWeekCaches };
}
