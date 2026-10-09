"use client";

import {
  addMonths,
  buildMonthWeeks,
  fromDateKey,
  getMonday,
  MONTH_NAMES,
  toDateKey,
} from "./types";
import type { TimeTrackerState } from "./use-time-tracker";

/** The week-jump picker: a year grid of month thumbnails that drills into a
 * month view where clicking a row jumps the Hour Logger to that week. */
export function WeekPickerCalendar({ state }: { state: TimeTrackerState }) {
  const {
    calendarOpen,
    setCalendarOpen,
    calendarView,
    setCalendarView,
    calendarYear,
    setCalendarYear,
    calendarMonth,
    setCalendarMonth,
    calendarRef,
    weekStart,
    setWeekStart,
    calendarTodayKey,
    calendarMonthWeeks,
  } = state;

  if (!calendarOpen) return null;

  return (
    <>
      <div
        className="day-logger-overlay absolute inset-0 z-30 rounded-2xl bg-overlay/20 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={() => setCalendarOpen(false)}
      />
      <div className="day-logger-dialog-wrap absolute inset-0 z-40 flex items-start justify-end overflow-y-auto p-3 pointer-events-none sm:p-4">
      <div
        ref={calendarRef}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a week"
        style={{ zoom: 0.7 }}
        className="calendar-card day-logger-dialog flex w-full max-w-[880px] flex-col overflow-hidden rounded-2xl shadow-2xl shadow-shade/60 pointer-events-auto max-h-[min(94dvh,920px)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-glass/10 px-4 py-3">
          <div className="flex items-center gap-2">
            {calendarView === "month" ? (
              <button
                type="button"
                onClick={() => setCalendarView("year")}
                className="rounded-lg border border-glass/20 bg-glass/10 px-2.5 py-1 text-xs text-ink-2 transition hover:bg-glass/15"
                aria-label="Back to year view"
              >
                <span aria-hidden>&lsaquo;</span> {fromDateKey(calendarMonth).getFullYear()}
              </button>
            ) : null}
            <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {calendarView === "year"
                ? calendarYear
                : `${MONTH_NAMES[fromDateKey(calendarMonth).getMonth()]} ${fromDateKey(calendarMonth).getFullYear()}`}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                if (calendarView === "year") setCalendarYear(now.getFullYear());
                else setCalendarMonth(toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
              }}
              className="rounded-lg border border-glass/20 bg-glass/10 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-glass/15"
            >
              Today
            </button>
            <button
              type="button"
              aria-label={calendarView === "year" ? "Previous year" : "Previous month"}
              onClick={() => {
                if (calendarView === "year") setCalendarYear((y) => y - 1);
                else setCalendarMonth((m) => addMonths(m, -1));
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-glass/20 bg-glass/10 text-ink-2 transition hover:bg-glass/15"
            >
              <span aria-hidden>&lsaquo;</span>
            </button>
            <button
              type="button"
              aria-label={calendarView === "year" ? "Next year" : "Next month"}
              onClick={() => {
                if (calendarView === "year") setCalendarYear((y) => y + 1);
                else setCalendarMonth((m) => addMonths(m, 1));
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-glass/20 bg-glass/10 text-ink-2 transition hover:bg-glass/15"
            >
              <span aria-hidden>&rsaquo;</span>
            </button>
            <button
              type="button"
              aria-label="Close calendar"
              onClick={() => setCalendarOpen(false)}
              className="group ml-1 flex h-8 w-8 items-center justify-center rounded-lg border border-glass/20 bg-glass/10 text-lg leading-none text-ink-2 transition hover:bg-glass/15"
            >
              <span className="inline-block transition-transform duration-200 group-hover:rotate-90" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {calendarView === "year" ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              {MONTH_NAMES.map((name, monthIdx) => {
                const monthKey = `${calendarYear}-${String(monthIdx + 1).padStart(2, "0")}-01`;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setCalendarMonth(monthKey);
                      setCalendarView("month");
                    }}
                    className="group rounded-xl p-1.5 text-left transition hover:bg-glass/[0.06]"
                  >
                    <p className="mb-1.5 text-lg font-semibold text-danger/90 transition group-hover:text-danger">{name}</p>
                    <div className="grid grid-cols-7 text-center text-xs text-ink-4/70">
                      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                        <span key={i} className="py-0.5">
                          {d}
                        </span>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 text-center text-sm tabular-nums">
                      {buildMonthWeeks(monthKey)
                        .flat()
                        .map((day) => {
                          const dayKey = toDateKey(day);
                          const inMonth = day.getMonth() === monthIdx;
                          const isToday = dayKey === calendarTodayKey;
                          return (
                            <span
                              key={dayKey}
                              className={`py-1 ${!inMonth ? "text-transparent" : isToday ? "font-semibold text-ink" : "text-ink-2/80"}`}
                            >
                              {inMonth && isToday ? (
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-ink">
                                  {day.getDate()}
                                </span>
                              ) : (
                                day.getDate()
                              )}
                            </span>
                          );
                        })}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="mb-1 grid grid-cols-7 text-center text-xs uppercase tracking-wide text-ink-3/70">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <span key={d} className="py-1">
                    {d}
                  </span>
                ))}
              </div>
              <div className="space-y-1.5">
                {calendarMonthWeeks.map((week) => {
                  const rowMonday = toDateKey(getMonday(toDateKey(week[0])));
                  const isSelectedWeek = rowMonday === weekStart;
                  return (
                    <button
                      key={rowMonday}
                      type="button"
                      onClick={() => {
                        setWeekStart(rowMonday);
                        setCalendarOpen(false);
                      }}
                      className={`grid w-full grid-cols-7 gap-1 rounded-xl border px-1 py-1 text-center transition ${
                        isSelectedWeek
                          ? "border-accent/50 bg-accent/15"
                          : "border-transparent hover:border-glass/15 hover:bg-glass/[0.06]"
                      }`}
                    >
                      {week.map((day) => {
                        const dayKey = toDateKey(day);
                        const inMonth = day.getMonth() === fromDateKey(calendarMonth).getMonth();
                        const isToday = dayKey === calendarTodayKey;
                        return (
                          <span
                            key={dayKey}
                            className={`flex h-9 items-center justify-center rounded-lg text-sm tabular-nums ${
                              inMonth ? "text-ink" : "text-ink-5"
                            }`}
                          >
                            {isToday ? (
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 font-semibold text-ink">
                                {day.getDate()}
                              </span>
                            ) : (
                              day.getDate()
                            )}
                          </span>
                        );
                      })}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-center text-xs text-ink-4">Pick a week to jump the Hour Logger to it.</p>
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
