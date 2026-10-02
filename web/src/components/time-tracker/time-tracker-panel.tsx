"use client";

import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { AnimatedNumber } from "./animated-number";
import { DayCard } from "./day-card";
import { DayLoggerModal } from "./day-logger-modal";
import {
  addDays,
  fmtHM,
  fmtSignedHM,
  fromDateKey,
  getMonday,
  type TimeTrackerPanelProps,
  toDateKey,
} from "./types";
import { useTimeTracker } from "./use-time-tracker";
import { WeekPickerCalendar } from "./week-picker-calendar";

/** Labelled divider between the Mon–Fri and Weekend day groups. */
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="h-px min-w-[1.5rem] flex-1 bg-gradient-to-r from-transparent to-white/20" aria-hidden />
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-5">{label}</span>
      <span className="h-px min-w-[1.5rem] flex-1 bg-gradient-to-l from-transparent to-white/20" aria-hidden />
    </div>
  );
}

export function TimeTrackerPanel({ readOnly = false, apiBase, viewingLabel, initialWeek }: TimeTrackerPanelProps = {}) {
  const state = useTimeTracker({ readOnly, apiBase, initialWeek });
  const {
    weekStart,
    setWeekStart,
    loading,
    calendarOpen,
    setCalendarOpen,
    editorPortalReady,
    editorOpen,
    activeWeekData,
    hasActiveWeekData,
    weekLoadTick,
    showUpToDateSweep,
    weekdayDays,
    weekendDays,
  } = state;

  return (
    <>
    <section className="underwater-panel relative grid overflow-hidden rounded-2xl transition-[grid-template-columns,gap] duration-500 ease-out gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,0fr)] lg:items-start">
      {/* One grid cell for the main card so it stays in the wide column (not the 0fr track). */}
      <div className="relative min-h-0 min-w-0 w-full lg:col-start-1 lg:row-start-1">
        <div className="glass-card hourlogger-surface relative z-[1] w-full min-w-0 rounded-2xl p-4 transition-[width,padding] duration-500 ease-out md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-accent-soft/80">Time Tracker</p>
            <h2 className="text-lg font-semibold md:text-xl">Hour Logger</h2>
            {viewingLabel ? (
              <p className="mt-1 text-xs text-warn/90">Viewing: {viewingLabel}</p>
            ) : null}
          </div>
          <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end sm:gap-2">
            <button
              type="button"
              onClick={() => setCalendarOpen((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={calendarOpen}
              aria-label="Open calendar to jump to a week"
              title="Jump to a week"
              className="flex items-center justify-center rounded-lg border border-glass/20 bg-glass/10 px-3 py-2 text-ink-2 transition hover:bg-glass/15"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
                <path d="M3 9h18M8 2.5v4M16 2.5v4" />
              </svg>
            </button>
            <Button
              variant="glass-quiet"
              size="md"
              onClick={() => {
                const prev = addDays(fromDateKey(weekStart), -7);
                setWeekStart(toDateKey(prev));
              }}
              className="flex-1 sm:flex-none"
            >
              Prev week
            </Button>
            <Button
              variant="glass-quiet"
              size="md"
              onClick={() => {
                setWeekStart(toDateKey(getMonday()));
              }}
              className="flex-1 sm:flex-none"
            >
              Today
            </Button>
            <Button
              variant="glass-quiet"
              size="md"
              onClick={() => {
                const next = addDays(fromDateKey(weekStart), 7);
                setWeekStart(toDateKey(next));
              }}
              className="flex-1 sm:flex-none"
            >
              Next week
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-3">
          <span className="flex min-w-0 items-center justify-between gap-3 rounded-full border border-glass/20 bg-glass/10 px-3 py-1.5 tabular-nums">
            <span className="shrink-0">Weekly hours:</span>
            <span className="inline-block min-w-[8ch] text-right">
              {hasActiveWeekData ? (
                <AnimatedNumber key={`week-hours-${weekLoadTick}`} value={activeWeekData?.week_hours_mins ?? 0} durationMs={320}>
                  {(value) => fmtHM(Math.round(value))}
                </AnimatedNumber>
              ) : (
                <span className="inline-block h-4 w-16 animate-pulse rounded bg-glass/20" aria-hidden="true" />
              )}
            </span>
          </span>
          <span className="flex min-w-0 items-center justify-between gap-3 rounded-full border border-glass/20 bg-glass/10 px-3 py-1.5 tabular-nums">
            <span className="shrink-0">Overtime bank:</span>
            <span className="inline-block min-w-[9ch] text-right">
              {hasActiveWeekData ? (
                <AnimatedNumber key={`overtime-bank-${weekLoadTick}`} value={activeWeekData?.overtime_bank_mins ?? 0} durationMs={320}>
                  {(value) => fmtSignedHM(Math.round(value))}
                </AnimatedNumber>
              ) : (
                <span className="inline-block h-4 w-20 animate-pulse rounded bg-glass/20" aria-hidden="true" />
              )}
            </span>
          </span>
        </div>

        <div className={`scroll-mt-24 mt-5 space-y-8 ${showUpToDateSweep ? "day-grid-ready" : ""}`}>
          {hasActiveWeekData ? (
            <>
              <div>
                <SectionDivider label="Mon – Fri" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {weekdayDays.map((day, i) => (
                    <DayCard key={day.date} state={state} day={day} index={i} />
                  ))}
                </div>
              </div>
              <div>
                <SectionDivider label="Weekend" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {weekendDays.map((day, i) => (
                    <DayCard key={day.date} state={state} day={day} index={5 + i} />
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
        {loading && !hasActiveWeekData ? <p className="mt-3 text-sm text-ink-2/80">Loading tracker week...</p> : null}
        </div>
        <WeekPickerCalendar state={state} />
      </div>
    </section>
    {editorPortalReady && editorOpen
      ? createPortal(<DayLoggerModal state={state} />, document.body)
      : null}
    </>
  );
}
