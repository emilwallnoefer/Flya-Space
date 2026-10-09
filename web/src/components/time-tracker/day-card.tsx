"use client";

import type { CSSProperties } from "react";
import {
  isPremiumOvertimeDay,
  isSaturdayDate,
  isSundayDate,
  isWeekendDate,
} from "@/lib/time-tracker-rules";
import { AnimatedNumber } from "./animated-number";
import { type DayData, dayLabel, fmtHM, TARGET_MINS } from "./types";
import type { TimeTrackerState } from "./use-time-tracker";

/** One liquid day tile: animated progress bar (core / overtime / compensated
 * segments), day-type badges, and the Compensate / Standard quick actions. */
export function DayCard({ state, day, index }: { state: TimeTrackerState; day: DayData; index: number }) {
  const {
    selectedDay,
    calendarTodayKey,
    revealedDayCount,
    showUpToDateSweep,
    weekLoadTick,
    readOnly,
    handleEditDay,
    handleFillMissing,
    handleFillDay,
  } = state;

  const isSelected = selectedDay?.date === day.date;
  const isToday = day.date === calendarTodayKey;
  const revealed = index < revealedDayCount;
  const isSickLeave = day.sick_leave;
  // Vacation and public holiday share the same excused/premium-overtime rule.
  const isExcusedHoliday = day.holiday || day.public_holiday;
  const isRelaxDay = isWeekendDate(day.date) || isExcusedHoliday || isSickLeave;
  // Sick leave is excused but never earns overtime, so no worked hours show on the bar.
  const premiumOvertimeDay = !isSickLeave && isPremiumOvertimeDay(day.date, day.net_mins, isExcusedHoliday);
  const workedBaseMins = Math.min(day.net_mins, TARGET_MINS);
  const overtimeWorkedMinsWeekday = premiumOvertimeDay
    ? Math.max(0, day.net_mins)
    : Math.max(0, day.net_mins - TARGET_MINS);
  const overtimeCompMins = Math.max(0, day.comp_mins);

  const displayDonePct = isRelaxDay
    ? 100
    : Math.round(((day.net_mins + day.comp_mins) / TARGET_MINS) * 100);

  let restPct = 0;
  let sandPct = 0;
  let algaePct = 0;
  let compPct = 0;
  let restDelayMs = 0;
  let restDurMs = 0;
  let sandDelayMs = 0;
  let sandDurMs = 0;
  let algaeDelayMs = 0;
  let algaeDurMs = 0;
  let compDelayMs = 0;
  let compDurMs = 0;

  const baseDelay = index * 80 + 65;
  const minDurMs = 80;
  const msPerPct = 6;
  const dur = (pct: number) => (pct > 0 ? Math.max(minDurMs, Math.round(pct * msPerPct)) : 0);

  if (isRelaxDay) {
    const otWork = isSickLeave ? 0 : Math.max(0, day.net_mins);
    const barTotalMins = TARGET_MINS + otWork + overtimeCompMins;
    restPct = (TARGET_MINS / barTotalMins) * 100;
    algaePct = (otWork / barTotalMins) * 100;
    compPct = (overtimeCompMins / barTotalMins) * 100;
    restDelayMs = baseDelay;
    restDurMs = dur(restPct);
    algaeDurMs = dur(algaePct);
    compDurMs = dur(compPct);
    algaeDelayMs = restDelayMs + restDurMs;
    compDelayMs = algaeDelayMs + algaeDurMs;
  } else {
    const barTotalMins = Math.max(
      TARGET_MINS,
      (premiumOvertimeDay ? 0 : workedBaseMins) + overtimeWorkedMinsWeekday + overtimeCompMins,
    );
    sandPct = ((premiumOvertimeDay ? 0 : workedBaseMins) / barTotalMins) * 100;
    algaePct = (overtimeWorkedMinsWeekday / barTotalMins) * 100;
    compPct = (overtimeCompMins / barTotalMins) * 100;
    sandDelayMs = baseDelay;
    sandDurMs = dur(sandPct);
    algaeDurMs = dur(algaePct);
    compDurMs = dur(compPct);
    algaeDelayMs = sandDelayMs + sandDurMs;
    compDelayMs = algaeDelayMs + algaeDurMs;
  }

  const isSat = isSaturdayDate(day.date);
  const isSun = isSundayDate(day.date);
  const isVac = day.holiday;
  const isPh = day.public_holiday;
  const isSl = isSickLeave;

  return (
    <article
      key={day.date}
      className={`liquid-day-card rounded-xl p-3 transition-[border-color,background-color,box-shadow,transform,opacity] duration-300 ease-out ${
        isSat ? "liquid-day-card--sat" : ""
      } ${isSun ? "liquid-day-card--sun" : ""} ${isVac ? "liquid-day-card--vac" : ""} ${
        isPh ? "liquid-day-card--ph" : ""
      } ${isSl ? "liquid-day-card--sl" : ""
      } ${isToday ? "liquid-day-card--today" : ""
      } ${isSelected ? "day-card-selected" : ""
      } ${revealed ? "opacity-100" : "pointer-events-none opacity-0"}`}
      style={{ "--day-sweep-delay": `${index * 58}ms` } as CSSProperties}
      aria-current={isToday ? "date" : undefined}
    >
      {showUpToDateSweep && revealed ? <span className="day-ready-sweep-beam" aria-hidden="true" /> : null}
      <button
        type="button"
        onClick={() => {
          handleEditDay(day.date);
        }}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className={`text-xs ${isToday ? "font-semibold text-ink" : "text-ink-3/80"}`}>{dayLabel(day.date)}</p>
            {isToday ? (
              <span className="day-today-badge shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider">
                Today
              </span>
            ) : null}
            {isSat ? (
              <span className="shrink-0 rounded border border-indigo-400/35 bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent-soft/95">
                Sat
              </span>
            ) : null}
            {isSun ? (
              <span className="shrink-0 rounded border border-rose-400/35 bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-danger/95">
                Sun
              </span>
            ) : null}
            {isVac ? (
              <span className="shrink-0 rounded border border-amber-400/45 bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn/95">
                VAC
              </span>
            ) : null}
            {isPh ? (
              <span className="shrink-0 rounded border border-violet-400/45 bg-violet-500/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-violet-100/95">
                PH
              </span>
            ) : null}
            {isSl ? (
              <span className="shrink-0 rounded border border-teal-400/45 bg-teal-500/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-teal-100/95">
                SL
              </span>
            ) : null}
          </div>
          <AnimatedNumber key={`day-pct-${day.date}-${weekLoadTick}`} value={displayDonePct}>
            {(value) => <p className="shrink-0 text-xs font-medium text-accent-soft/90">{Math.round(value)}%</p>}
          </AnimatedNumber>
        </div>
        <AnimatedNumber key={`day-worked-${day.date}-${weekLoadTick}`} value={day.net_mins}>
          {(value) => (
            <p className="mt-1 text-sm font-medium">
              {day.sick_leave
                ? "Sick leave"
                : day.public_holiday
                  ? day.net_mins > 0
                    ? `Public holiday · ${fmtHM(Math.round(value))} worked`
                    : "Public holiday"
                  : day.holiday
                    ? day.net_mins > 0
                      ? `Vacation · ${fmtHM(Math.round(value))} worked`
                      : "Vacation"
                    : `${fmtHM(Math.round(value))} worked`}
            </p>
          )}
        </AnimatedNumber>
        <div className="day-progress mt-3" aria-label="Day progress bar">
          <AnimatedNumber key={`day-topdown-${day.date}-${weekLoadTick}`} value={Math.max(0, Math.min(100, displayDonePct))}>
            {(value) => (
              <span
                className="day-progress-topdown"
                style={{ height: `${value}%`, animationDelay: `${index * 80}ms` }}
              />
            )}
          </AnimatedNumber>
          {isRelaxDay ? (
            <AnimatedNumber key={`day-rest-${day.date}-${weekLoadTick}`} value={restPct}>
              {(value) => (
                <span
                  className="day-progress-segment day-progress-rest"
                  style={{
                    width: `${Math.max(0, value)}%`,
                    animationDelay: `${restDelayMs}ms`,
                    animationDuration: `${restDurMs || minDurMs}ms`,
                    animationTimingFunction: "linear",
                  }}
                />
              )}
            </AnimatedNumber>
          ) : (
            <AnimatedNumber key={`day-sand-${day.date}-${weekLoadTick}`} value={sandPct}>
              {(value) => (
                <span
                  className="day-progress-segment day-progress-sand"
                  style={{
                    width: `${Math.max(0, value)}%`,
                    animationDelay: `${sandDelayMs}ms`,
                    animationDuration: `${sandDurMs || minDurMs}ms`,
                    animationTimingFunction: "linear",
                  }}
                />
              )}
            </AnimatedNumber>
          )}
          <AnimatedNumber key={`day-algae-${day.date}-${weekLoadTick}`} value={algaePct}>
            {(value) => (
              <span
                className="day-progress-segment day-progress-algae"
                style={{
                  width: `${Math.max(0, value)}%`,
                  animationDelay: `${algaeDelayMs}ms`,
                  animationDuration: `${algaeDurMs || minDurMs}ms`,
                  animationTimingFunction: "linear",
                }}
              />
            )}
          </AnimatedNumber>
          <AnimatedNumber key={`day-comp-${day.date}-${weekLoadTick}`} value={compPct}>
            {(value) => (
              <span
                className="day-progress-segment day-progress-comp"
                style={{
                  width: `${Math.max(0, value)}%`,
                  animationDelay: `${compDelayMs}ms`,
                  animationDuration: `${compDurMs || minDurMs}ms`,
                  animationTimingFunction: "linear",
                }}
              />
            )}
          </AnimatedNumber>
        </div>
        {isRelaxDay ? (
          <div className="mt-2 space-y-1 text-[11px] font-medium text-ink">
            {day.net_mins > 0 ? (
              <AnimatedNumber key={`day-ot-worked-${day.date}-${weekLoadTick}`} value={day.net_mins}>
                {(overtimeValue) => (
                  <div className="flex w-full items-baseline justify-between gap-3">
                    <span className="shrink-0 text-left font-normal">Overtime worked</span>
                    <span className="tabular-nums text-right text-positive/95">{fmtHM(Math.round(overtimeValue))}</span>
                  </div>
                )}
              </AnimatedNumber>
            ) : null}
            {overtimeCompMins > 0 ? (
              <AnimatedNumber key={`day-ot-comp-${day.date}-${weekLoadTick}`} value={overtimeCompMins}>
                {(compValue) => (
                  <div className="flex w-full items-baseline justify-between gap-3">
                    <span className="shrink-0 text-left font-normal">Overtime compensated</span>
                    <span className="tabular-nums text-right">{fmtHM(Math.round(compValue))}</span>
                  </div>
                )}
              </AnimatedNumber>
            ) : null}
          </div>
        ) : (
          <AnimatedNumber key={`day-core-${day.date}-${weekLoadTick}`} value={premiumOvertimeDay ? 0 : workedBaseMins}>
            {(coreValue) => (
              <div className="mt-2 space-y-1 text-[11px] font-medium text-ink">
                <div className="flex w-full items-baseline justify-between gap-3">
                  <span className="shrink-0 text-left font-normal">Core hours</span>
                  <span className="tabular-nums text-right">{fmtHM(Math.round(coreValue))}</span>
                </div>
                {overtimeWorkedMinsWeekday > 0 ? (
                  <AnimatedNumber key={`day-ot-worked-${day.date}-${weekLoadTick}`} value={overtimeWorkedMinsWeekday}>
                    {(overtimeValue) => (
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="shrink-0 text-left font-normal">Overtime worked</span>
                        <span className="tabular-nums text-right">{fmtHM(Math.round(overtimeValue))}</span>
                      </div>
                    )}
                  </AnimatedNumber>
                ) : null}
                {overtimeCompMins > 0 ? (
                  <AnimatedNumber key={`day-ot-comp-${day.date}-${weekLoadTick}`} value={overtimeCompMins}>
                    {(compValue) => (
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="shrink-0 text-left font-normal">Overtime compensated</span>
                        <span className="tabular-nums text-right">{fmtHM(Math.round(compValue))}</span>
                      </div>
                    )}
                  </AnimatedNumber>
                ) : null}
              </div>
            )}
          </AnimatedNumber>
        )}
      </button>
      {readOnly ? null : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              void handleFillMissing(day.date);
            }}
            className="flex-1 rounded-lg border border-glass/20 bg-glass/10 px-2 py-2.5 text-xs hover:bg-glass/15 sm:py-1.5"
          >
            Compensate
            <br />
            Day
          </button>
          <button
            type="button"
            onClick={() => {
              void handleFillDay(day.date);
            }}
            className="flex-1 rounded-lg border border-glass/20 bg-glass/10 px-2 py-2.5 text-xs hover:bg-glass/15 sm:py-1.5"
          >
            Standard
            <br />
            Day
          </button>
        </div>
      )}
    </article>
  );
}
