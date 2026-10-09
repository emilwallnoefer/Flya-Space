"use client";

import { AnimatePresence } from "framer-motion";
import type { TimeTrackerState } from "@/components/time-tracker/use-time-tracker";
import { fmtHM, type WeekResponse } from "@/components/time-tracker/types";
import { Toast } from "@/components/ui";
import { playUiSound } from "@/lib/ui-sounds";
import { cn } from "@/lib/cn";
import { MobileButton, MobileSheet } from "../primitives";

type DayType = "normal" | "holiday" | "public_holiday" | "sick";

/**
 * The phone's day editor: a bottom sheet over the week list, driven entirely
 * by the shared hook's form state. Native time pickers, a 2×2 day-type grid,
 * the ±15 break counter (or the break list for older weeks), travel info as
 * a collapsed section, Save as the sticky footer.
 */
export function MobileDaySheet({
  state,
  open,
  onClose,
  travelDebug,
}: {
  state: TimeTrackerState;
  open: boolean;
  onClose: () => void;
  travelDebug: WeekResponse["travel_debug"];
}) {
  const {
    readOnly,
    saving,
    toast,
    setToast,
    selectedDay,
    panelDateLabel,
    dayDetailsLoading,
    selectedTravelInfo,
    compSourceRows,
    compTotalMins,
    formStart,
    setFormStart,
    formStop,
    setFormStop,
    formHoliday,
    setFormHoliday,
    formPublicHoliday,
    setFormPublicHoliday,
    formSickLeave,
    setFormSickLeave,
    formBreaks,
    setFormBreaks,
    formTotalBreakMins,
    setFormBreakCounter,
    selectedDaySupportsBreaks,
    selectedDayUsesBreakCounter,
    computedNet,
    handleSaveDay,
    handleResetDay,
  } = state;

  const dayType: DayType = formHoliday ? "holiday" : formPublicHoliday ? "public_holiday" : formSickLeave ? "sick" : "normal";
  const disabled = !selectedDay || readOnly;
  const inputClass = "min-h-12 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink tabular-nums focus:border-accent/40 focus:outline-none";
  const hasTravel = selectedTravelInfo && (selectedTravelInfo.client || selectedTravelInfo.location || selectedTravelInfo.responsible);

  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      full
      title={panelDateLabel}
      footer={
        readOnly ? (
          <p className="text-center text-xs text-ink-4">Read-only view — saving is disabled.</p>
        ) : (
          <div className="flex gap-2">
            <MobileButton variant="secondary" className="w-auto flex-none px-5" disabled={saving || !selectedDay} onClick={() => { playUiSound("resetTap"); void handleResetDay(); }}>
              Reset
            </MobileButton>
            <MobileButton disabled={saving || !selectedDay} onClick={() => void handleSaveDay()}>
              {saving ? "Saving…" : `Save · ${fmtHM(computedNet)}`}
            </MobileButton>
          </div>
        )
      }
    >
      <div className="space-y-5 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-4">Start</span>
            <input type="time" value={formStart} disabled={disabled} onChange={(e) => setFormStart(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-4">Stop</span>
            <input type="time" value={formStop} disabled={disabled} onChange={(e) => setFormStop(e.target.value)} className={inputClass} />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs text-ink-4">Day type</span>
          <div role="radiogroup" aria-label="Day type" className="grid grid-cols-2 gap-1.5 rounded-xl bg-glass/8 p-1.5">
            {(
              [
                { key: "normal", label: "Normal", active: "bg-raised text-ink shadow-sm" },
                { key: "holiday", label: "Vacation", active: "bg-amber-500/25 text-amber-50 shadow-sm" },
                { key: "public_holiday", label: "Public holiday", active: "bg-violet-500/25 text-violet-50 shadow-sm" },
                { key: "sick", label: "Sick leave", active: "bg-teal-500/25 text-teal-50 shadow-sm" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={dayType === opt.key}
                disabled={disabled}
                onClick={() => {
                  setFormHoliday(opt.key === "holiday");
                  setFormPublicHoliday(opt.key === "public_holiday");
                  setFormSickLeave(opt.key === "sick");
                }}
                className={cn("min-h-10 rounded-lg px-2 text-sm font-medium transition disabled:opacity-50", dayType === opt.key ? opt.active : "text-ink-4")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {formHoliday || formPublicHoliday ? (
            <p className="mt-1.5 text-xs leading-snug text-ink-4">Excused from your target. Hours logged count as overtime (same as a weekend).</p>
          ) : formSickLeave ? (
            <p className="mt-1.5 text-xs leading-snug text-ink-4">Excused from your target. Hours logged don&apos;t count as overtime.</p>
          ) : null}
        </div>

        {selectedDaySupportsBreaks ? (
          <div>
            <span className="mb-1.5 block text-xs text-ink-4">Breaks</span>
            {readOnly ? (
              <div className="rounded-xl border border-glass/10 bg-panel px-4 py-3 text-sm text-ink-2">
                {formBreaks.length === 0 ? "No breaks logged." : formBreaks.map((b, i) => <div key={i} className="flex justify-between"><span>{b.name || "Break"}</span><span className="tabular-nums">{b.mins} min</span></div>)}
              </div>
            ) : selectedDayUsesBreakCounter ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setFormBreakCounter(formTotalBreakMins - 15)} aria-label="15 minutes less break" className="grid h-12 w-14 place-items-center rounded-xl border border-glass/15 bg-glass/8 text-lg font-semibold text-ink active:bg-glass/12">
                  −
                </button>
                <div className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-glass/10 bg-panel text-base font-semibold tabular-nums text-ink">
                  {formTotalBreakMins} min
                </div>
                <button type="button" onClick={() => setFormBreakCounter(formTotalBreakMins + 15)} aria-label="15 minutes more break" className="grid h-12 w-14 place-items-center rounded-xl border border-glass/15 bg-glass/8 text-lg font-semibold text-ink active:bg-glass/12">
                  +
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {formBreaks.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <input placeholder="Name" value={item.name} onChange={(e) => setFormBreaks(formBreaks.map((b, i) => (i === index ? { ...b, name: e.target.value } : b)))} className={cn(inputClass, "flex-1")} />
                    <input type="number" inputMode="numeric" min={0} value={item.mins} onChange={(e) => setFormBreaks(formBreaks.map((b, i) => (i === index ? { ...b, mins: Number(e.target.value) || 0 } : b)))} className={cn(inputClass, "w-24")} />
                    <button type="button" onClick={() => setFormBreaks(formBreaks.filter((_, i) => i !== index))} aria-label="Remove break" className="grid h-12 w-12 place-items-center rounded-xl text-danger active:bg-glass/8">
                      ×
                    </button>
                  </div>
                ))}
                <MobileButton variant="secondary" onClick={() => setFormBreaks([...formBreaks, { name: "Break", mins: 30 }])}>
                  Add break
                </MobileButton>
              </div>
            )}
          </div>
        ) : null}

        <details className="rounded-xl border border-glass/10 bg-panel">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] text-ink">
            Travel info
            <span className="text-xs text-ink-4">{dayDetailsLoading ? "Loading…" : hasTravel ? selectedTravelInfo?.client : "None"}</span>
          </summary>
          <div className="border-t border-glass/10 px-4 py-3 text-sm">
            {dayDetailsLoading ? (
              <p className="text-ink-4">Loading travel details…</p>
            ) : hasTravel ? (
              <dl className="space-y-2">
                <Row k="Client" v={selectedTravelInfo?.client} />
                <Row k="Location" v={selectedTravelInfo?.location} />
                <Row k="Responsible" v={selectedTravelInfo?.responsible} />
              </dl>
            ) : (
              <p className="text-ink-4">
                No travel info found for this date.
                {travelDebug?.hint ? <span className="mt-1 block text-xs text-ink-5">{travelDebug.hint}</span> : null}
              </p>
            )}
            {selectedDay && selectedDay.comp_mins > 0 && compSourceRows.length > 0 ? (
              <div className="mt-3 border-t border-glass/10 pt-3">
                <p className="text-xs uppercase tracking-[0.12em] text-ink-4">Compensation from · {fmtHM(compTotalMins)}</p>
                <ul className="mt-1.5 space-y-1 text-xs text-ink-3">
                  {compSourceRows.map((row) => (
                    <li key={row.date} className="flex justify-between gap-2">
                      <span className="truncate">{row.date}{row.client ? ` · ${row.client}` : ""}</span>
                      <span className="shrink-0 tabular-nums">{fmtHM(row.mins)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>

        <AnimatePresence>
          {toast ? (
            <Toast key="mobile-day-toast" tone={toast.kind === "ok" ? "positive" : "danger"} onDismiss={() => setToast(null)}>
              {toast.message}
            </Toast>
          ) : null}
        </AnimatePresence>
      </div>
    </MobileSheet>
  );
}

function Row({ k, v }: { k: string; v: string | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-4">{k}</dt>
      <dd className="text-right text-ink">{v || "–"}</dd>
    </div>
  );
}
