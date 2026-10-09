"use client";

import type { TimeTrackerState } from "@/components/time-tracker/use-time-tracker";
import { addMonths, fromDateKey, getMonday, MONTH_NAMES, toDateKey } from "@/components/time-tracker/types";
import { cn } from "@/lib/cn";
import { ChevronIcon, MobileSheet } from "../primitives";

/**
 * Pick a week: one month at a time, each row a week, tap a row to jump the
 * tracker to it. Uses the hook's calendar state (month, grid, today).
 */
export function MobileWeekPicker({ state, open, onClose }: { state: TimeTrackerState; open: boolean; onClose: () => void }) {
  const { weekStart, setWeekStart, calendarMonth, setCalendarMonth, calendarMonthWeeks, calendarTodayKey } = state;
  const monthDate = fromDateKey(calendarMonth);
  const monthLabel = `${MONTH_NAMES[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

  return (
    <MobileSheet open={open} onClose={onClose} title="Pick a week">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))} aria-label="Previous month" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
          <ChevronIcon className="h-5 w-5 rotate-180" />
        </button>
        <span className="text-[15px] font-semibold text-ink">{monthLabel}</span>
        <button type="button" onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))} aria-label="Next month" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
          <ChevronIcon className="h-5 w-5" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-ink-5">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="space-y-1.5 pb-2">
        {calendarMonthWeeks.map((week) => {
          const rowMonday = toDateKey(getMonday(toDateKey(week[0])));
          const selected = rowMonday === weekStart;
          return (
            <button
              key={rowMonday}
              type="button"
              onClick={() => {
                setWeekStart(rowMonday);
                onClose();
              }}
              className={cn("grid w-full grid-cols-7 gap-1 rounded-xl border px-1 py-1 text-center", selected ? "border-accent/50 bg-accent/15" : "border-transparent active:bg-glass/8")}
            >
              {week.map((day) => {
                const key = toDateKey(day);
                const inMonth = day.getMonth() === monthDate.getMonth();
                const today = key === calendarTodayKey;
                return (
                  <span key={key} className={cn("flex h-10 items-center justify-center text-sm tabular-nums", inMonth ? "text-ink" : "text-ink-5")}>
                    {today ? <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 font-semibold text-white">{day.getDate()}</span> : day.getDate()}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => { setWeekStart(toDateKey(getMonday())); onClose(); }} className="mb-2 w-full py-2 text-center text-sm font-medium text-accent-soft">
        Jump to this week
      </button>
    </MobileSheet>
  );
}
