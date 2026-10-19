"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { AnimatePresence, m, type Variants } from "framer-motion";
import { useTimeTracker, type TimeTrackerState } from "@/components/time-tracker/use-time-tracker";
import { addDays, fmtHM, fmtSignedHM, fromDateKey, getMonday, TARGET_MINS, toDateKey, type DayData, type WeekResponse } from "@/components/time-tracker/types";
import { isPremiumOvertimeDay, isWeekendDate } from "@/lib/time-tracker-rules";
import { cn } from "@/lib/cn";
import { swipeDirection } from "@/lib/swipe-direction";
import { ChevronIcon, MobileGroup } from "../primitives";
import { MobileDaySheet } from "./mobile-day-sheet";
import { MobileWeekPicker } from "./mobile-week-picker";

/**
 * The phone's Time Tracker: a week as a plain list of seven rows, two stat
 * chips, and a bottom sheet to log a day (where the quick fills live too).
 * Swipe sideways to change week: the day list follows the finger and slides
 * across to the next week. Same hook as the desktop (`useTimeTracker`),
 * so saves, rollbacks, travel lookups and the overtime bank behave the same.
 */
export function MobileTimeScreen({
  initialWeek,
  editToday = false,
  readOnly = false,
  apiBase,
  viewingLabel,
}: {
  initialWeek: WeekResponse | null;
  /** Open today's day sheet as soon as the week is there (the Home quick action). */
  editToday?: boolean;
  readOnly?: boolean;
  apiBase?: string;
  viewingLabel?: string;
}) {
  const state = useTimeTracker({ readOnly, apiBase, initialWeek, manageEditorChrome: false });
  const { weekStart, setWeekStart, loading, data, activeWeekData, calendarTodayKey, handleEditDay, editorOpen, returnToWeekdays, revealedDayCount } = state;
  const [pickerOpen, setPickerOpen] = useState(false);

  // "Log today" from Home: open today's sheet once the week has loaded.
  const editTodayDone = useRef(false);
  useEffect(() => {
    if (!editToday || editTodayDone.current || !activeWeekData) return;
    if (!activeWeekData.days.some((day) => day.date === calendarTodayKey)) return;
    editTodayDone.current = true;
    handleEditDay(calendarTodayKey);
  }, [editToday, activeWeekData, calendarTodayKey, handleEditDay]);

  const monday = fromDateKey(weekStart);
  const sunday = addDays(monday, 6);
  const isCurrentWeek = weekStart === toDateKey(getMonday());
  const weekLabel = `${monday.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${sunday.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  const days = activeWeekData?.days ?? [];
  const stepWeek = (by: number) => setWeekStart(toDateKey(addDays(monday, by * 7)));

  // Which way the last week change went (+1 later, -1 earlier), so the day
  // list slides in from the matching side whatever changed the week (swipe,
  // chevrons, Today, the picker). Updated during render, React's pattern for
  // state derived from a changing value.
  const [slide, setSlide] = useState({ week: weekStart, dir: 0 });
  if (slide.week !== weekStart) setSlide({ week: weekStart, dir: weekStart > slide.week ? 1 : -1 });

  // A drag that ends on a day row must not also open that day.
  const draggedRef = useRef(false);

  // Swipe sideways elsewhere on the screen (chips, week row) to step a week;
  // the day list handles its own drag. Ignored while a sheet is open, since
  // its touches bubble up here too.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    const inList = e.target instanceof Element && e.target.closest("[data-week-days]");
    touchStart.current = e.touches.length === 1 && t && !inList ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || editorOpen || pickerOpen) return;
    const dir = swipeDirection(t.clientX - start.x, t.clientY - start.y);
    if (dir) stepWeek(dir === "left" ? 1 : -1);
  };

  return (
    <div className="space-y-4 px-4 pt-1" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={() => (touchStart.current = null)}>
      {viewingLabel ? <p className="text-xs text-warn/90">Viewing: {viewingLabel}</p> : null}

      <div className="grid grid-cols-2 gap-3">
        <StatChip label="This week" value={activeWeekData ? fmtHM(activeWeekData.week_hours_mins) : "—"} detail={activeWeekData ? `of ${fmtHM(activeWeekData.target_mins * 5)}` : undefined} />
        <StatChip
          label="Overtime bank"
          value={activeWeekData ? fmtSignedHM(activeWeekData.overtime_bank_mins) : "—"}
          tone={activeWeekData ? (activeWeekData.overtime_bank_mins >= 0 ? "accent" : "warn") : "default"}
        />
      </div>

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => stepWeek(-1)} aria-label="Previous week" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
          <ChevronIcon className="h-5 w-5 rotate-180" />
        </button>
        <button type="button" onClick={() => setPickerOpen(true)} className="flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl active:bg-glass/8" aria-haspopup="dialog" aria-label={`${weekLabel}, pick a week`}>
          <span className="text-[15px] font-semibold text-ink">{weekLabel}</span>
        </button>
        <button type="button" onClick={() => stepWeek(1)} aria-label="Next week" className="grid h-11 w-11 place-items-center rounded-xl text-ink-3 active:bg-glass/10">
          <ChevronIcon className="h-5 w-5" />
        </button>
        {/* Always there, so the days below never shift; dimmed on the current week. */}
        <button
          type="button"
          onClick={() => setWeekStart(toDateKey(getMonday()))}
          disabled={isCurrentWeek}
          aria-label="Go to this week"
          className="ml-1 shrink-0 rounded-full border border-glass/15 px-2.5 py-1 text-xs font-medium text-accent-soft active:bg-glass/10 disabled:text-ink-5 disabled:opacity-60"
        >
          Today
        </button>
      </div>

      {/* No placeholder rows while the week loads: the group stays empty and the
          real rows fade in one after another, on the same reveal cadence as the
          desktop day cards (the hook's revealedDayCount). After a week change
          the rows arrive with the slide instead, all at once. */}
      <div className="relative -mx-4 overflow-hidden px-4">
        <AnimatePresence initial={false} mode="popLayout" custom={slide.dir}>
          <m.div
            key={weekStart}
            data-week-days
            custom={slide.dir}
            variants={WEEK_SLIDE}
            initial="enter"
            animate="center"
            exit="exit"
            drag={editorOpen || pickerOpen ? false : "x"}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.7}
            onPointerDown={() => (draggedRef.current = false)}
            onDragStart={() => (draggedRef.current = true)}
            onDragEnd={(_event, info) => {
              const far = Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 500;
              if (far && Math.abs(info.offset.x) > 16) stepWeek(info.offset.x < 0 ? 1 : -1);
            }}
            onClickCapture={(e) => {
              if (!draggedRef.current) return;
              draggedRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <MobileGroup title={loading && !activeWeekData ? "Loading…" : "Days"}>
              {days.map((day, i) => (
                <DayRow key={day.date} day={day} state={state} isToday={day.date === calendarTodayKey} revealed={slide.dir !== 0 || i < revealedDayCount} />
              ))}
            </MobileGroup>
          </m.div>
        </AnimatePresence>
      </div>

      <MobileDaySheet state={state} open={editorOpen} onClose={returnToWeekdays} travelDebug={data?.travel_debug} />
      <MobileWeekPicker state={state} open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

const WEEK_EASE = [0.32, 0.72, 0, 1] as const;

// Out the side the finger pushed toward, in from the other. `dir` is the week
// change (+1 later), so a later week enters from the right.
const WEEK_SLIDE: Variants = {
  enter: (dir: number) => ({ x: dir >= 0 ? "100%" : "-100%", opacity: 0.4 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.34, ease: WEEK_EASE } },
  exit: (dir: number) => ({ x: dir >= 0 ? "-100%" : "100%", opacity: 0.4, transition: { duration: 0.34, ease: WEEK_EASE } }),
};

function StatChip({ label, value, detail, tone = "default" }: { label: string; value: string; detail?: string; tone?: "default" | "accent" | "warn" }) {
  return (
    <div className="m-tile rounded-2xl border border-glass/10 bg-panel px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-4">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums leading-tight", tone === "accent" ? "text-accent-soft" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
      {detail ? <p className="text-xs text-ink-4">{detail}</p> : null}
    </div>
  );
}

function DayRow({ day, state, isToday, revealed }: { day: DayData; state: TimeTrackerState; isToday: boolean; revealed: boolean }) {
  const { handleEditDay } = state;
  const date = fromDateKey(day.date);
  const weekend = isWeekendDate(day.date);
  const excused = day.holiday || day.public_holiday;
  const logged = day.net_mins > 0;
  const premium = !day.sick_leave && isPremiumOvertimeDay(day.date, day.net_mins, excused);
  const base = premium ? 0 : Math.min(day.net_mins, TARGET_MINS);
  const overtime = premium ? Math.max(0, day.net_mins) : Math.max(0, day.net_mins - TARGET_MINS);
  const comp = Math.max(0, day.comp_mins);
  const total = Math.max(TARGET_MINS, base + overtime + comp);
  const pct = (mins: number) => `${(mins / total) * 100}%`;
  const badge = day.holiday ? "Vacation" : day.public_holiday ? "Public holiday" : day.sick_leave ? "Sick leave" : null;
  const breakMins = (day.breaks ?? []).reduce((sum, b) => sum + Math.max(0, b.mins || 0), 0);
  const status = badge ?? (logged ? `${day.start_time}–${day.stop_time}` : comp > 0 ? "Compensated" : weekend ? "Weekend" : "Not logged");

  // A plain row: the day, what was logged, the total. Filling a day
  // (compensate / standard day) lives in the day sheet, not here.
  return (
    <button type="button" onClick={() => handleEditDay(day.date)} className={cn(
        "relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-opacity duration-300 ease-out",
        isToday && "bg-accent/[0.14] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent",
        revealed ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      aria-current={isToday ? "date" : undefined}
    >
      <span className="w-11 shrink-0">
        <span className={cn("block text-[11px] font-semibold uppercase tracking-wide", isToday ? "text-accent-soft" : weekend ? "text-ink-5" : "text-ink-4")}>
          {isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" })}
        </span>
        {isToday ? (
          <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-accent text-base font-bold tabular-nums text-slate-950">{date.getDate()}</span>
        ) : (
          <span className="block text-xl font-semibold leading-tight tabular-nums text-ink">{date.getDate()}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] text-ink">
            {status}
            {logged && breakMins > 0 ? <span className="text-ink-4"> · break {breakMins}m</span> : null}
          </span>
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", logged ? "text-ink" : "text-ink-5")}>{logged ? fmtHM(day.net_mins) : comp > 0 ? fmtHM(comp) : "—"}</span>
        </span>
        <span className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-glass/10" aria-hidden>
          {base > 0 ? <span className="h-full bg-emerald-400/80" style={{ width: pct(base) }} /> : null}
          {overtime > 0 ? <span className="h-full bg-accent" style={{ width: pct(overtime) }} /> : null}
          {comp > 0 ? <span className="h-full bg-rose-400/80" style={{ width: pct(comp) }} /> : null}
        </span>
      </span>
      <ChevronIcon className="h-4 w-4 shrink-0 text-ink-5" />
    </button>
  );
}
