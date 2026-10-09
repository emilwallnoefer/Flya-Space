"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playUiSound, stopUiSound } from "@/lib/ui-sounds";
import {
  bankDeltaForDay,
  computeNetMins,
  dayLabel,
  type DayBreak,
  type DayData,
  getMonday,
  RECONCILE_DEBOUNCE_MS,
  TARGET_MINS,
  type TimeTrackerPanelProps,
  toDateKey,
  type ToastState,
  type WeekResponse,
} from "./types";
import { useDayForm } from "./hooks/use-day-form";
import { useWeekCache } from "./hooks/use-week-cache";
import { useWeekCalendar } from "./hooks/use-week-calendar";

/** All Hour Logger state. Week fetching/caching, the week-picker calendar and
 * the day editor form live in `./hooks/`; this orchestrator owns week
 * navigation, the reveal cascade, and the optimistic writes with debounced
 * reconcile, and wires the pieces together. */
export function useTimeTracker({
  readOnly = false,
  apiBase,
  initialWeek,
  manageEditorChrome = true,
}: TimeTrackerPanelProps & {
  /**
   * Whether the hook locks page scroll and binds Escape while the day editor
   * is open. The desktop modal relies on it; the phone's bottom sheet does
   * both itself, so it passes false.
   */
  manageEditorChrome?: boolean;
}) {
  const [weekStart, setWeekStart] = useState<string>(toDateKey(getMonday()));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  // Seeded synchronously from the SSR-provided week so the first paint shows
  // the day cards; the mount effect below would otherwise apply the cached
  // week only after an initial placeholder frame.
  const [data, setData] = useState<WeekResponse | null>(() =>
    initialWeek && initialWeek.week_start === weekStart ? initialWeek : null,
  );
  const [weekLoadTick, setWeekLoadTick] = useState(0);
  // Mirrors `data` for effects that must read the latest week without
  // subscribing to it (the mount/cache effect below).
  const dataRef = useRef<WeekResponse | null>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [revealedDayCount, setRevealedDayCount] = useState(7);
  const [showUpToDateSweep, setShowUpToDateSweep] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPortalReady, setEditorPortalReady] = useState(false);
  const [dayDetailsLoading, setDayDetailsLoading] = useState(false);
  const previousEditorOpenRef = useRef<boolean | null>(null);
  // Monotonic counter so a slow background refresh can't overwrite the result
  // of a newer one (e.g. when saving several days in quick succession).
  const refreshSeqRef = useRef(0);
  // Bumped by every optimistic local edit. A reconcile compares this before and
  // after its fetch so it can tell whether the response it got back is already
  // out of date with respect to what the user has done since.
  const writeSeqRef = useRef(0);
  // Set below once scheduleReconcile exists; lets refreshWeek re-arm the
  // debounce without a circular useCallback dependency.
  const scheduleReconcileRef = useRef<(() => void) | null>(null);

  const { weekCacheRef, fetchWeekData, prefetchNearbyWeeks, clearWeekCaches } = useWeekCache(
    apiBase,
    initialWeek && initialWeek.week_start === weekStart ? initialWeek : null,
  );
  const calendar = useWeekCalendar(weekStart);

  const selectedDay = useMemo(() => {
    if (!data?.days?.length) return null;
    if (!selectedDate) return null;
    return data.days.find((day) => day.date === selectedDate) ?? null;
  }, [data, selectedDate]);

  const selectedTravelInfo = useMemo(() => {
    if (!selectedDate) return null;
    return data?.travel_by_date?.[selectedDate] ?? null;
  }, [data?.travel_by_date, selectedDate]);

  // Overtime-earning days that fund the selected day's compensation, joined
  // with the travel client/location for each source day (when the sheet has
  // a row for it).
  const compSourceRows = useMemo(() => {
    if (!selectedDate) return [];
    const sources = data?.comp_sources?.[selectedDate];
    if (!sources?.length) return [];
    return sources
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((source) => {
        const travel = data?.travel_by_date?.[source.date];
        return {
          date: source.date,
          mins: source.mins,
          earned: source.earned,
          client: travel?.client || "",
          location: travel?.location || "",
        };
      });
  }, [data?.comp_sources, data?.travel_by_date, selectedDate]);

  const compTotalMins = useMemo(
    () => compSourceRows.reduce((sum, source) => sum + source.mins, 0),
    [compSourceRows],
  );

  // Monday of the current week, read once per mount so it stays stable across
  // renders (a session crossing midnight re-renders on the next week change).
  const [currentWeekStartKey] = useState(() => toDateKey(getMonday()));
  const form = useDayForm({ editorOpen, selectedDate, data, currentWeekStartKey });
  const {
    formStart,
    formStop,
    formHoliday,
    formPublicHoliday,
    formSickLeave,
    formBreaks,
  } = form;

  const applyWeekData = useCallback((weekData: WeekResponse) => {
    setData(weekData);
    const days = weekData.days ?? [];
    setSelectedDate((prev) => {
      if (prev && days.some((day) => day.date === prev)) return prev;
      return null;
    });
    setEditorOpen(false);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadWeek() {
      try {
        const cached = weekCacheRef.current.get(weekStart);
        if (cached) {
          if (!active) return;
          // Skip when this exact week object is already live (seeded from the
          // SSR week at mount) so the reveal cascade doesn't run twice.
          if (cached !== dataRef.current) {
            applyWeekData(cached);
            setWeekLoadTick((prev) => prev + 1);
          }
          prefetchNearbyWeeks(weekStart);
          return;
        }
        setLoading(true);
        const weekData = await fetchWeekData(weekStart, { includeTravel: false });
        if (!active) return;
        applyWeekData(weekData);
        setWeekLoadTick((prev) => prev + 1);
        prefetchNearbyWeeks(weekStart);
      } catch (error) {
        if (!active) return;
        setToast({ kind: "error", message: (error as Error).message });
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadWeek();
    return () => {
      active = false;
    };
  }, [applyWeekData, fetchWeekData, prefetchNearbyWeeks, weekStart, weekCacheRef]);

  useEffect(() => {
    const total = data?.days?.length ?? 0;
    if (total === 0) return;
    playUiSound("daysAppearStart");
    setRevealedDayCount(0);
    setShowUpToDateSweep(false);
    let current = 0;
    const intervalId = window.setInterval(() => {
      current += 1;
      setRevealedDayCount(current);
      if (current >= total) {
        window.clearInterval(intervalId);
        setShowUpToDateSweep(true);
        window.setTimeout(() => setShowUpToDateSweep(false), 980);
      }
    }, 85);
    return () => window.clearInterval(intervalId);
  }, [weekLoadTick, data?.days?.length]);

  useEffect(() => {
    if (showUpToDateSweep) {
      playUiSound("weekReadyGlow");
      return () => stopUiSound("weekReadyGlow");
    }
    stopUiSound("weekReadyGlow");
    return undefined;
  }, [showUpToDateSweep]);

  useEffect(() => {
    setEditorPortalReady(true);
  }, []);

  useEffect(() => {
    const previous = previousEditorOpenRef.current;
    previousEditorOpenRef.current = editorOpen;
    if (previous == null || previous === editorOpen) return;
    playUiSound("dayLoggerSlide");
  }, [editorOpen]);

  const refreshWeek = useCallback(async () => {
    // Background reconciliation after a mutation. Unlike `applyWeekData`, this
    // must NOT close the editor or reset the selected day: the user may have
    // already opened another day while the previous save's POST was in flight.
    const seq = ++refreshSeqRef.current;
    const targetWeek = weekStart;
    const previous = weekCacheRef.current.get(targetWeek);
    // Snapshot the write counter: any optimistic edit that lands while the GET
    // below is in flight makes this response stale by definition, because the
    // server had not seen that edit when it built the payload.
    const writeSeqAtStart = writeSeqRef.current;
    // Reconcile hours / comp / bank only — never re-fetch the slow Google
    // Sheets travel data here. Re-pulling travel on every save was the main
    // source of the post-edit lag; we carry the already-loaded travel forward.
    const fresh = await fetchWeekData(targetWeek, { force: true, includeTravel: false });
    // Drop the result if a newer refresh started or the week changed meanwhile.
    if (seq !== refreshSeqRef.current) return;
    // Drop it too if the user edited anything mid-flight — applying it would
    // visibly revert that edit until the next reconcile ("save → unsave →
    // save"). Re-arm instead so the newer state still gets reconciled.
    if (writeSeqRef.current !== writeSeqAtStart || pendingWritesRef.current > 0) {
      scheduleReconcileRef.current?.();
      return;
    }
    const merged: WeekResponse = previous?.includes_travel
      ? {
          ...fresh,
          travel_by_date: previous.travel_by_date,
          travel_debug: previous.travel_debug,
          includes_travel: true,
        }
      : fresh;
    weekCacheRef.current.set(targetWeek, merged);
    setData((prev) => (prev && prev.week_start !== targetWeek ? prev : merged));
    prefetchNearbyWeeks(targetWeek);
  }, [fetchWeekData, prefetchNearbyWeeks, weekStart, weekCacheRef]);

  // Debounced, coalesced background reconcile. A burst of compensate / save
  // clicks schedules at most one server refetch once writes have settled,
  // instead of the old "force-refresh after every click" which fought the
  // optimistic UI and caused the bars to snap back mid-entry.
  const pendingWritesRef = useRef(0);
  const reconcileTimerRef = useRef<number | null>(null);

  const runReconcile = useCallback(() => {
    if (pendingWritesRef.current > 0) {
      reconcileTimerRef.current = window.setTimeout(runReconcile, RECONCILE_DEBOUNCE_MS);
      return;
    }
    reconcileTimerRef.current = null;
    void refreshWeek().catch(() => {
      // Keep the optimistic UI if the background sync fails.
    });
  }, [refreshWeek]);

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimerRef.current != null) window.clearTimeout(reconcileTimerRef.current);
    reconcileTimerRef.current = window.setTimeout(runReconcile, RECONCILE_DEBOUNCE_MS);
  }, [runReconcile]);

  scheduleReconcileRef.current = scheduleReconcile;

  useEffect(() => {
    return () => {
      if (reconcileTimerRef.current != null) window.clearTimeout(reconcileTimerRef.current);
    };
  }, []);

  const ensureWeekDetails = useCallback(async () => {
    const current = weekCacheRef.current.get(weekStart);
    if (current?.includes_travel) return;
    setDayDetailsLoading(true);
    // This fires on every day-open, so a save very often lands while it is
    // still in flight — see the note on `writeSeqRef`.
    const writeSeqAtStart = writeSeqRef.current;
    try {
      const fullWeek = await fetchWeekData(weekStart, { force: true, includeTravel: true });
      const staleForLocalEdits =
        writeSeqRef.current !== writeSeqAtStart || pendingWritesRef.current > 0;
      if (!staleForLocalEdits) {
        setData(fullWeek);
        return;
      }
      // The user edited a day while this was loading. Replacing the week
      // wholesale would revert that edit, so graft on only the travel fields
      // (which the user never edits) and keep the local day values.
      const live = dataRef.current;
      if (!live || live.week_start !== fullWeek.week_start) return;
      const merged: WeekResponse = {
        ...live,
        travel_by_date: fullWeek.travel_by_date,
        travel_debug: fullWeek.travel_debug,
        includes_travel: true,
      };
      weekCacheRef.current.set(merged.week_start, merged);
      setData(merged);
    } catch {
      // Keep editor interaction responsive even if details fetch fails.
    } finally {
      setDayDetailsLoading(false);
    }
  }, [fetchWeekData, weekStart, weekCacheRef]);

  const returnToWeekdays = useCallback(() => {
    setEditorOpen(false);
    setSelectedDate(null);
  }, []);

  useEffect(() => {
    if (!editorOpen || !manageEditorChrome) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editorOpen, manageEditorChrome]);

  useEffect(() => {
    if (!editorOpen || !manageEditorChrome) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") returnToWeekdays();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorOpen, manageEditorChrome, returnToWeekdays]);

  const patchDayInCurrentWeek = useCallback(
    (date: string, updater: (day: DayData) => DayData, options?: { bankDeltaMins?: number }) => {
      const bankDelta = options?.bankDeltaMins ?? 0;
      // Mark local state as newer than any reconcile response already in flight.
      writeSeqRef.current += 1;
      setData((prev) => {
        if (!prev) return prev;
        const dayIndex = prev.days.findIndex((day) => day.date === date);
        if (dayIndex < 0) return prev;
        const prevDay = prev.days[dayIndex];
        const nextDay = updater(prevDay);
        const nextDays = [...prev.days];
        nextDays[dayIndex] = nextDay;

        const weekHoursDelta = nextDay.net_mins - prevDay.net_mins;

        const nextWeek: WeekResponse = {
          ...prev,
          week_hours_mins: prev.week_hours_mins + weekHoursDelta,
          overtime_bank_mins: prev.overtime_bank_mins + bankDelta,
          days: nextDays,
        };
        weekCacheRef.current.set(weekStart, nextWeek);
        return nextWeek;
      });

      // The overtime bank is a single cumulative total shown identically on
      // every week, so keep all other cached weeks in step with the same delta.
      // This avoids wiping the prefetch cache on each edit (the old behavior),
      // which is what made week navigation stutter after compensating.
      if (bankDelta) {
        for (const [key, week] of weekCacheRef.current) {
          if (key === weekStart) continue;
          weekCacheRef.current.set(key, {
            ...week,
            overtime_bank_mins: week.overtime_bank_mins + bankDelta,
          });
        }
      }
    },
    [weekStart, weekCacheRef],
  );

  async function postAction<T extends Record<string, unknown>>(body: unknown): Promise<T> {
    const response = await fetch("/api/time-tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Action failed");
    return payload as T;
  }

  // Fire a write and tie it into the debounced reconcile. The UI is already
  // updated optimistically by the caller, so this never blocks interaction;
  // it only tracks in-flight writes so the single reconcile waits for the
  // burst to finish before refetching the authoritative server state.
  async function commitWrite<T extends Record<string, unknown>>(body: unknown): Promise<T> {
    pendingWritesRef.current += 1;
    try {
      return await postAction<T>(body);
    } finally {
      pendingWritesRef.current -= 1;
      scheduleReconcile();
    }
  }

  function handleSaveDay() {
    if (readOnly) return;
    if (!selectedDay) return;
    const date = selectedDay.date;
    const nextBreaks = formBreaks.map((item) => ({ ...item }));
    const netMins = computeNetMins(formStart, formStop, nextBreaks);
    const breaksChanged =
      selectedDay.breaks.length !== nextBreaks.length ||
      selectedDay.breaks.some((item, index) => {
        const next = nextBreaks[index];
        if (!next) return true;
        return item.name !== next.name || item.mins !== next.mins;
      });
    const hasChanges =
      selectedDay.start_time !== formStart ||
      selectedDay.stop_time !== formStop ||
      Boolean(selectedDay.holiday) !== Boolean(formHoliday) ||
      Boolean(selectedDay.public_holiday) !== Boolean(formPublicHoliday) ||
      Boolean(selectedDay.sick_leave) !== Boolean(formSickLeave) ||
      selectedDay.net_mins !== netMins ||
      breaksChanged;

    if (hasChanges) {
      playUiSound("saveConfirm");
    }

    const previousDaySnapshot: DayData = {
      ...selectedDay,
      breaks: selectedDay.breaks.map((item) => ({ ...item })),
    };
    const nextDaySnapshot: DayData = {
      ...previousDaySnapshot,
      start_time: formStart,
      stop_time: formStop,
      net_mins: netMins,
      holiday: formHoliday,
      public_holiday: formPublicHoliday,
      sick_leave: formSickLeave,
      breaks: nextBreaks,
    };
    const bankDelta = bankDeltaForDay(previousDaySnapshot, nextDaySnapshot);

    // Optimistic save: close editor and update card (and bank) immediately.
    patchDayInCurrentWeek(
      date,
      (day) => ({
        ...day,
        start_time: formStart,
        stop_time: formStop,
        net_mins: netMins,
        holiday: formHoliday,
        public_holiday: formPublicHoliday,
        sick_leave: formSickLeave,
        breaks: nextBreaks,
      }),
      { bankDeltaMins: bankDelta },
    );
    returnToWeekdays();

    void commitWrite<{ ok: boolean }>({
      action: "save_day",
      day: {
        work_date: date,
        start_time: formStart,
        stop_time: formStop,
        holiday: formHoliday,
        public_holiday: formPublicHoliday,
        sick_leave: formSickLeave,
        net_mins: netMins,
        breaks: nextBreaks,
      },
    })
      .then(() => {
        setToast({ kind: "ok", message: "Day saved." });
      })
      .catch((error) => {
        // Roll back optimistic values (and the bank) if persistence failed.
        patchDayInCurrentWeek(
          date,
          () => ({
            ...previousDaySnapshot,
            breaks: previousDaySnapshot.breaks.map((item) => ({ ...item })),
          }),
          { bankDeltaMins: -bankDelta },
        );
        setToast({ kind: "error", message: `Save failed. ${String((error as Error).message)}` });
      });
  }

  async function handleFillMissing(date: string) {
    if (readOnly) return;
    const currentDay = data?.days.find((day) => day.date === date);
    if (!currentDay) return;
    const worked = Math.max(0, currentDay.net_mins);
    const currentComp = Math.max(0, currentDay.comp_mins);
    const previousCompNote = currentDay.comp_note ?? "";
    const need = Math.max(0, TARGET_MINS - worked);
    // Toggle: clear if already fully compensated, otherwise top up to target.
    const optimisticNext = currentComp === need ? 0 : need;
    const nextNote = optimisticNext > 0 ? "auto-fill" : "";
    const bankDelta = bankDeltaForDay(currentDay, {
      ...currentDay,
      comp_mins: optimisticNext,
      comp_note: nextNote,
    });

    // Fully optimistic: update the day, the week's bank, and every cached
    // week's bank instantly. The value is computed here, so the backend write
    // is a single direct `set_comp` (no read-modify-write, no forced reload).
    patchDayInCurrentWeek(
      date,
      (day) => ({ ...day, comp_mins: optimisticNext, comp_note: nextNote }),
      { bankDeltaMins: bankDelta },
    );
    playUiSound("fillSwoosh");

    try {
      await commitWrite<{ ok: boolean; comp_mins: number }>({
        action: "set_comp",
        work_date: date,
        mins: optimisticNext,
      });
    } catch (error) {
      // Roll back the optimistic value and bank if the request failed.
      patchDayInCurrentWeek(
        date,
        (day) => ({
          ...day,
          comp_mins: currentComp,
          comp_note: currentComp > 0 ? previousCompNote : "",
        }),
        { bankDeltaMins: -bankDelta },
      );
      setToast({ kind: "error", message: (error as Error).message });
    }
  }

  async function handleFillDay(date: string) {
    if (readOnly) return;
    const currentDay = data?.days.find((day) => day.date === date);
    if (!currentDay) return;

    const nextBreaks: DayBreak[] = [{ name: "Break", mins: 30 }];
    const nextStart = "09:00";
    const nextStop = "17:54";
    const nextHoliday = false;
    const nextPublicHoliday = false;
    const nextSickLeave = false;
    const nextNetMins = computeNetMins(nextStart, nextStop, nextBreaks);
    const previousDaySnapshot: DayData = {
      ...currentDay,
      breaks: currentDay.breaks.map((item) => ({ ...item })),
    };
    const nextDaySnapshot: DayData = {
      ...previousDaySnapshot,
      start_time: nextStart,
      stop_time: nextStop,
      net_mins: nextNetMins,
      holiday: nextHoliday,
      public_holiday: nextPublicHoliday,
      sick_leave: nextSickLeave,
      breaks: nextBreaks.map((item) => ({ ...item })),
    };
    const bankDelta = bankDeltaForDay(previousDaySnapshot, nextDaySnapshot);

    patchDayInCurrentWeek(
      date,
      (day) => ({
        ...day,
        start_time: nextStart,
        stop_time: nextStop,
        net_mins: nextNetMins,
        holiday: nextHoliday,
        public_holiday: nextPublicHoliday,
        sick_leave: nextSickLeave,
        breaks: nextBreaks.map((item) => ({ ...item })),
      }),
      { bankDeltaMins: bankDelta },
    );
    playUiSound("fillSwoosh");

    try {
      await commitWrite<{ ok: boolean }>({
        action: "save_day",
        day: {
          work_date: date,
          start_time: nextStart,
          stop_time: nextStop,
          holiday: nextHoliday,
          public_holiday: nextPublicHoliday,
          sick_leave: nextSickLeave,
          net_mins: nextNetMins,
          breaks: nextBreaks,
        },
      });
      setToast({ kind: "ok", message: "Day filled." });
    } catch (error) {
      patchDayInCurrentWeek(
        date,
        () => ({
          ...previousDaySnapshot,
          breaks: previousDaySnapshot.breaks.map((item) => ({ ...item })),
        }),
        { bankDeltaMins: -bankDelta },
      );
      setToast({ kind: "error", message: `Fill day failed. ${String((error as Error).message)}` });
    }
  }

  async function handleResetDay() {
    if (readOnly) return;
    if (!selectedDay) return;
    const date = selectedDay.date;
    const previousDaySnapshot: DayData = {
      ...selectedDay,
      breaks: selectedDay.breaks.map((item) => ({ ...item })),
    };
    const clearedDay: DayData = {
      ...previousDaySnapshot,
      start_time: "",
      stop_time: "",
      net_mins: 0,
      holiday: false,
      public_holiday: false,
      sick_leave: false,
      comp_mins: 0,
      comp_note: "",
      breaks: [],
    };
    const bankDelta = bankDeltaForDay(previousDaySnapshot, clearedDay);

    // Optimistic reset: clear the day + bank and close the editor immediately.
    setSaving(true);
    patchDayInCurrentWeek(date, () => ({ ...clearedDay, breaks: [] }), { bankDeltaMins: bankDelta });
    returnToWeekdays();
    try {
      await commitWrite<{ ok: boolean }>({ action: "reset_day", work_date: date });
      setToast({ kind: "ok", message: "Day reset." });
    } catch (error) {
      patchDayInCurrentWeek(
        date,
        () => ({
          ...previousDaySnapshot,
          breaks: previousDaySnapshot.breaks.map((item) => ({ ...item })),
        }),
        { bankDeltaMins: -bankDelta },
      );
      setToast({ kind: "error", message: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onImported(event: Event) {
      const detail = (event as CustomEvent<{ imported_day_logs?: number; error?: string }>).detail;
      if (detail?.error) {
        setToast({ kind: "error", message: detail.error });
        return;
      }
      // A JSON import rewrites days across many weeks, so the cached/prefetched
      // neighbor weeks can't be patched incrementally — drop them and let them
      // refetch on next visit. (Single-day edits keep their caches in step.)
      clearWeekCaches();
      void refreshWeek()
        .then(() => {
          setToast({
            kind: "ok",
            message: `Import done (${String(detail?.imported_day_logs ?? 0)} days).`,
          });
        })
        .catch((error) => {
          setToast({ kind: "error", message: (error as Error).message });
        });
    }

    window.addEventListener("time-tracker-imported", onImported as EventListener);
    return () => window.removeEventListener("time-tracker-imported", onImported as EventListener);
  }, [refreshWeek, clearWeekCaches]);

  useEffect(() => {
    // Saving/resetting the travel mapping in Settings changes what every
    // cached week's travel data means, so drop all caches and re-read the
    // sheet with the new columns for the visible week right away.
    function onTravelMappingChanged() {
      clearWeekCaches();
      const writeSeqAtStart = writeSeqRef.current;
      void fetchWeekData(weekStart, { force: true, includeTravel: true })
        .then((fullWeek) => {
          // Same staleness rule as the other server-payload appliers: never let
          // a response that predates a local edit overwrite that edit.
          if (writeSeqRef.current !== writeSeqAtStart || pendingWritesRef.current > 0) {
            const live = dataRef.current;
            if (!live || live.week_start !== fullWeek.week_start) return;
            const merged: WeekResponse = {
              ...live,
              travel_by_date: fullWeek.travel_by_date,
              travel_debug: fullWeek.travel_debug,
              includes_travel: true,
            };
            weekCacheRef.current.set(merged.week_start, merged);
            setData(merged);
            return;
          }
          setData((prev) => (prev && prev.week_start !== fullWeek.week_start ? prev : fullWeek));
        })
        .catch(() => {
          // The next editor open re-fetches travel; no need to surface this.
        });
    }

    window.addEventListener("ma-travel-mapping-changed", onTravelMappingChanged);
    return () => window.removeEventListener("ma-travel-mapping-changed", onTravelMappingChanged);
  }, [fetchWeekData, weekStart, clearWeekCaches, weekCacheRef]);

  function handleEditDay(date: string) {
    setSelectedDate(date);
    setEditorOpen(true);
    void ensureWeekDetails();
  }

  const selectedDaySupportsBreaks = Boolean(selectedDay);
  // New break-counter UX applies from current week onward; older logs keep legacy row editing.
  const selectedDayUsesBreakCounter = Boolean(
    selectedDay && selectedDay.date >= currentWeekStartKey,
  );
  const computedNet = computeNetMins(formStart, formStop, selectedDaySupportsBreaks ? formBreaks : []);
  const panelDateLabel = selectedDay ? dayLabel(selectedDay.date) : "Select a day";
  const activeWeekData = data?.week_start === weekStart ? data : null;
  const hasActiveWeekData = Boolean(activeWeekData);
  const weekdayDays = useMemo(() => (activeWeekData?.days ?? []).slice(0, 5), [activeWeekData?.days]);
  const weekendDays = useMemo(() => (activeWeekData?.days ?? []).slice(5, 7), [activeWeekData?.days]);

  return {
    readOnly,
    weekStart,
    setWeekStart,
    loading,
    saving,
    toast,
    setToast,
    data,
    weekLoadTick,
    revealedDayCount,
    showUpToDateSweep,
    selectedDate,
    calendarOpen: calendar.calendarOpen,
    setCalendarOpen: calendar.setCalendarOpen,
    calendarView: calendar.calendarView,
    setCalendarView: calendar.setCalendarView,
    calendarYear: calendar.calendarYear,
    setCalendarYear: calendar.setCalendarYear,
    calendarMonth: calendar.calendarMonth,
    setCalendarMonth: calendar.setCalendarMonth,
    calendarRef: calendar.calendarRef,
    editorOpen,
    editorPortalReady,
    dayDetailsLoading,
    selectedDay,
    selectedTravelInfo,
    compSourceRows,
    compTotalMins,
    formStart,
    setFormStart: form.setFormStart,
    formStop,
    setFormStop: form.setFormStop,
    formHoliday,
    setFormHoliday: form.setFormHoliday,
    formPublicHoliday,
    setFormPublicHoliday: form.setFormPublicHoliday,
    formSickLeave,
    setFormSickLeave: form.setFormSickLeave,
    formBreaks,
    setFormBreaks: form.setFormBreaks,
    currentWeekStartKey,
    returnToWeekdays,
    handleSaveDay,
    handleFillMissing,
    handleFillDay,
    handleResetDay,
    handleEditDay,
    selectedDaySupportsBreaks,
    selectedDayUsesBreakCounter,
    formTotalBreakMins: form.formTotalBreakMins,
    setFormBreakCounter: form.setFormBreakCounter,
    computedNet,
    panelDateLabel,
    activeWeekData,
    hasActiveWeekData,
    calendarTodayKey: calendar.calendarTodayKey,
    calendarMonthWeeks: calendar.calendarMonthWeeks,
    weekdayDays,
    weekendDays,
  };
}

export type TimeTrackerState = ReturnType<typeof useTimeTracker>;
