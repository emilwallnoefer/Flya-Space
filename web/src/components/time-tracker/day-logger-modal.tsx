"use client";

import { useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { Button, Input, Toast } from "@/components/ui";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { playUiSound } from "@/lib/ui-sounds";
import { dayLabel, escapeHtml, fmtHM, type WeekResponse } from "./types";
import type { TimeTrackerState } from "./use-time-tracker";

const TRAVEL_DEBUG_TITLES: Record<string, string> = {
  missing_refresh_token: "Travel data can't be pulled: no Google account connected",
  missing_mapping: "Travel data needs your column mapping",
  error: "Travel data can't be pulled",
  ok_empty: "Sheet is readable, but no travel rows were parsed",
  ok_all_blank: "Sheet is readable, but every travel cell is empty",
  ok_no_week_match: "Travel data loaded, nothing for this week",
  ok: "Travel data loaded",
  not_attempted: "Travel data not fetched yet",
};

/** Explains why travel info is missing for the selected day. Problem states
 * (no Google connection, fetch error, empty parse) get a highlighted box with
 * the actionable hint from the API; healthy states stay a quiet one-liner. */
function TravelDebugNote({ debug }: { debug: WeekResponse["travel_debug"] }) {
  if (!debug) return null;
  const isProblem =
    debug.status === "missing_refresh_token" ||
    debug.status === "missing_mapping" ||
    debug.status === "error" ||
    debug.status === "ok_empty" ||
    debug.status === "ok_all_blank";
  const title = TRAVEL_DEBUG_TITLES[debug.status] ?? debug.status;
  const account =
    debug.connected_google_email === undefined
      ? null
      : `Google account: ${debug.connected_google_email || "not connected"}${debug.used_custom_mapping ? " · personal column mapping active" : ""}`;

  if (!isProblem) {
    return (
      <p className="mt-3 text-xs text-ink-4/90">
        {title}: {debug.message} ({debug.fetched_dates} dates loaded, {debug.week_matches} in this week)
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-xs">
      <p className="font-medium text-warn">{title}</p>
      <p className="text-ink-3/90">{debug.message}</p>
      {debug.hint ? <p className="text-ink-3/90">{debug.hint}</p> : null}
      <p className="text-ink-4/90">
        {account ? <>{account} · </> : null}
        {debug.reason ? <>cause: {debug.reason} · </> : null}
        {debug.fetched_dates} dates loaded, {debug.week_matches} in this week
        {debug.blank_dates ? <> · {debug.blank_dates} rows with empty travel cells skipped</> : null}
      </p>
      {debug.effective_mapping ? (
        <p className="text-ink-4/90">
          Reading client/location/responsible from columns {debug.effective_mapping.clientColumn}/
          {debug.effective_mapping.locationColumn}/{debug.effective_mapping.responsibleColumn}, dates from{" "}
          {debug.effective_mapping.monthYearColumn}+{debug.effective_mapping.dayColumn}, range{" "}
          {debug.effective_mapping.range}
        </p>
      ) : null}
    </div>
  );
}

/** The full-screen day editor: start/stop + day-type + breaks form on the
 * left, travel info and the compensation-source breakdown (with PNG/text
 * export) on the right. Rendered into a portal by the panel. */
export function DayLoggerModal({ state }: { state: TimeTrackerState }) {
  const {
    returnToWeekdays,
    formStart,
    setFormStart,
    formStop,
    setFormStop,
    selectedDay,
    readOnly,
    formHoliday,
    setFormHoliday,
    formPublicHoliday,
    setFormPublicHoliday,
    formSickLeave,
    setFormSickLeave,
    selectedDaySupportsBreaks,
    formBreaks,
    setFormBreaks,
    selectedDayUsesBreakCounter,
    formTotalBreakMins,
    setFormBreakCounter,
    computedNet,
    saving,
    handleSaveDay,
    handleResetDay,
    toast,
    setToast,
    panelDateLabel,
    dayDetailsLoading,
    selectedTravelInfo,
    data,
    compSourceRows,
    compTotalMins,
  } = state;

  const exportCardRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The modal only mounts while open, so the trap is active for its whole life.
  useFocusTrap(dialogRef, true);

  async function handleCopyCompSourcesPng() {
    const node = exportCardRef.current;
    if (!node || !compSourceRows.length) return;
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("Clipboard images aren't supported in this browser.");
      }
      // Capture the dedicated, print-clean export card (an off-screen node)
      // rather than the live panel section, so the image gets its own tidy
      // borders/spacing. Transparent background keeps the card's rounded
      // corners; it carries its own solid surface color.
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: Math.max(2, window.devicePixelRatio || 1),
        cacheBust: true,
      });
      if (!blob) throw new Error("Could not render image.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setToast({ kind: "ok", message: "Compensation breakdown copied as image." });
    } catch (error) {
      setToast({ kind: "error", message: `Copy failed. ${String((error as Error).message)}` });
    }
  }

  // Build the breakdown as plain text + a matching HTML form. Odoo can't take
  // pasted PNGs, but its rich-text fields accept HTML (and plain-text fields
  // fall back to the text form), so we put both on the clipboard at once. Each
  // line is simply "date / travel / hours".
  function buildCompTextFormats() {
    const place = (source: (typeof compSourceRows)[number]) =>
      source.client || "No travel info";

    const lines = compSourceRows.map(
      (source) => `${dayLabel(source.date)} / ${place(source)} / ${fmtHM(source.mins)}`,
    );

    const text = lines.join("\n");
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827">` +
      lines.map((line) => escapeHtml(line)).join("<br>") +
      `</div>`;

    return { text, html };
  }

  async function handleCopyCompSourcesText() {
    if (!compSourceRows.length) return;
    const { text, html } = buildCompTextFormats();
    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard isn't available in this browser.");
      }
      setToast({ kind: "ok", message: "Compensation breakdown copied as text." });
    } catch (error) {
      setToast({ kind: "error", message: `Copy failed. ${String((error as Error).message)}` });
    }
  }

  return (
    <>
      <div
        className="day-logger-overlay fixed inset-0 z-[200] bg-overlay/70"
        aria-hidden="true"
        onClick={() => returnToWeekdays()}
      />
      <div className="day-logger-dialog-wrap fixed inset-0 z-[210] flex items-center justify-center overflow-y-auto p-4 pointer-events-none sm:p-6 max-h-[100dvh]">
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="glass-card day-logger-card day-logger-dialog my-auto flex w-full max-w-3xl flex-col rounded-2xl shadow-2xl shadow-shade/50 pointer-events-auto max-h-[min(92dvh,880px)] focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="day-logger-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5 scroll-mt-24">
          <div className="grid auto-rows-min items-start gap-4 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 id="day-logger-title" className="text-base font-semibold">
                  Day Logger
                </h3>
                <button
                  type="button"
                  onClick={() => returnToWeekdays()}
                  className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-glass/20 bg-glass/10 text-lg leading-none text-ink-2 transition hover:bg-glass/15"
                  aria-label="Close day editor"
                >
                  <span className="inline-block transition-transform duration-200 group-hover:rotate-90" aria-hidden>
                    ×
                  </span>
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-xs text-ink-3/80">{panelDateLabel}</p>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-2/90">Start</span>
                  <Input
                    type="time"
                    value={formStart}
                    disabled={!selectedDay || readOnly}
                    onChange={(event) => setFormStart(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-2/90">Stop</span>
                  <Input
                    type="time"
                    value={formStop}
                    disabled={!selectedDay || readOnly}
                    onChange={(event) => setFormStop(event.target.value)}
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-xs text-ink-2/90">Day type</span>
                  <div
                    role="radiogroup"
                    aria-label="Day type"
                    className="grid grid-cols-2 gap-1 rounded-lg border border-glass/15 bg-glass/[0.04] p-1"
                  >
                    {([
                      { key: "normal", label: "Normal", active: "bg-glass/15 text-ink shadow-sm" },
                      { key: "holiday", label: "Vacation", active: "bg-amber-500/25 text-amber-50 shadow-sm" },
                      { key: "public_holiday", label: "Public Holiday", active: "bg-violet-500/25 text-violet-50 shadow-sm" },
                      { key: "sick", label: "Sick leave", active: "bg-teal-500/25 text-teal-50 shadow-sm" },
                    ] as const).map((opt) => {
                      const isActive =
                        opt.key === "holiday"
                          ? formHoliday
                          : opt.key === "public_holiday"
                            ? formPublicHoliday
                            : opt.key === "sick"
                              ? formSickLeave
                              : !formHoliday && !formPublicHoliday && !formSickLeave;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          disabled={!selectedDay || readOnly}
                          onClick={() => {
                            setFormHoliday(opt.key === "holiday");
                            setFormPublicHoliday(opt.key === "public_holiday");
                            setFormSickLeave(opt.key === "sick");
                          }}
                          className={`rounded-md px-2 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            isActive ? opt.active : "text-ink-3/70 hover:text-ink"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {formHoliday || formPublicHoliday ? (
                    <p className="mt-1.5 text-xs leading-snug text-ink-4">
                      Excused from your target. Hours logged count as overtime (same as a weekend).
                    </p>
                  ) : formSickLeave ? (
                    <p className="mt-1.5 text-xs leading-snug text-ink-4">
                      Excused from your target. Hours logged don&apos;t count as overtime.
                    </p>
                  ) : null}
                </div>

                {selectedDaySupportsBreaks ? (
                  <div className="rounded-xl border border-glass/15 bg-glass/5 p-3">
                    <div className="mb-2.5 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.15em] text-accent-soft/80">Breaks</p>
                      </div>
                    </div>
                    {readOnly ? (
                      <div className="space-y-1 text-xs text-ink-2/90">
                        {formBreaks.length === 0 ? (
                          <p className="text-ink-3/80">No breaks logged.</p>
                        ) : (
                          formBreaks.map((item, index) => (
                            <div key={`${index}-ro`} className="flex justify-between">
                              <span>{item.name || "Break"}</span>
                              <span className="tabular-nums">{item.mins} min</span>
                            </div>
                          ))
                        )}
                      </div>
                    ) : selectedDayUsesBreakCounter ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setFormBreakCounter(formTotalBreakMins - 15)}
                            className="h-9 rounded-lg border border-glass/20 bg-glass/10 px-2 text-sm font-semibold tabular-nums transition hover:bg-glass/15"
                          >
                            -15
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormBreakCounter(formTotalBreakMins + 15)}
                            className="h-9 rounded-lg border border-glass/20 bg-glass/10 px-2 text-sm font-semibold tabular-nums transition hover:bg-glass/15"
                          >
                            +15
                          </button>
                        </div>
                        <div className="inline-flex w-full items-center justify-center rounded-lg border border-glass/20 bg-glass/10 px-2 py-2 text-sm font-semibold text-ink tabular-nums">
                          Break {formTotalBreakMins} min
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {formBreaks.length === 0 ? (
                          <p className="text-xs text-ink-3/80">No breaks added.</p>
                        ) : (
                          formBreaks.map((item, index) => (
                            <div key={`${index}-${item.name}`} className="grid gap-2 sm:grid-cols-[1fr_90px_auto]">
                              <input
                                placeholder="Name"
                                value={item.name}
                                onChange={(event) => {
                                  const name = event.target.value;
                                  setFormBreaks((prev) => prev.map((row, rowIdx) => (rowIdx === index ? { ...row, name } : row)));
                                }}
                                className="rounded-lg border border-glass/20 bg-glass/10 px-2 py-1.5 text-base sm:text-xs"
                              />
                              <input
                                type="number"
                                min={0}
                                placeholder="mins"
                                value={item.mins}
                                onChange={(event) => {
                                  const mins = Number.parseInt(event.target.value || "0", 10) || 0;
                                  setFormBreaks((prev) => prev.map((row, rowIdx) => (rowIdx === index ? { ...row, mins } : row)));
                                }}
                                className="rounded-lg border border-glass/20 bg-glass/10 px-2 py-1.5 text-base sm:text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => setFormBreaks((prev) => prev.filter((_, rowIdx) => rowIdx !== index))}
                                className="rounded-lg border border-rose-300/40 bg-rose-500/10 px-2 py-1.5 text-xs text-danger sm:px-2"
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                        <button
                          type="button"
                          onClick={() => setFormBreaks((prev) => [...prev, { name: "", mins: 0 }])}
                          className="rounded-lg border border-glass/20 bg-glass/10 px-2 py-1 text-xs hover:bg-glass/15"
                        >
                          Add break
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                <p className="text-xs text-ink-3/80">Computed total: {fmtHM(computedNet)}</p>

                {readOnly ? (
                  <p className="text-xs text-ink-4">Read-only view &mdash; saving is disabled.</p>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="accent"
                      size="md"
                      onClick={() => {
                        void handleSaveDay();
                      }}
                      disabled={saving || !selectedDay}
                      className="flex-1"
                    >
                      {saving ? "Saving…" : "Save day"}
                    </Button>
                    <Button
                      variant="glass-quiet"
                      size="md"
                      onClick={() => {
                        playUiSound("resetTap");
                        void handleResetDay();
                      }}
                      disabled={saving || !selectedDay}
                      className="flex-1"
                    >
                      Reset day
                    </Button>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {toast ? (
                  <Toast
                    key="day-logger-toast"
                    tone={toast.kind === "ok" ? "positive" : "danger"}
                    onDismiss={() => setToast(null)}
                    className="mt-4"
                  >
                    {toast.message}
                  </Toast>
                ) : null}
              </AnimatePresence>
            </div>

            <aside className="h-fit self-start rounded-xl border border-glass/15 bg-glass/5 p-4">
              <p className="text-xs uppercase tracking-[0.15em] text-accent-soft/80">Travel info</p>
              <p className="mt-2 text-xs text-ink-3/80">{panelDateLabel}</p>
              {!selectedDay ? (
                <p className="mt-4 text-sm text-ink-3/80">Select a day to edit details.</p>
              ) : dayDetailsLoading ? (
                <p className="mt-4 text-sm text-ink-3/80">Loading travel details...</p>
              ) : !selectedTravelInfo ||
                (!selectedTravelInfo.client && !selectedTravelInfo.location && !selectedTravelInfo.responsible) ? (
                <>
                  <p className="mt-4 text-sm text-ink-3/80">No travel info found for this date.</p>
                  <TravelDebugNote debug={data?.travel_debug} />
                </>
              ) : (
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-ink-3/75">Client</p>
                    <p className="mt-1">{selectedTravelInfo.client || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-ink-3/75">Location</p>
                    <p className="mt-1">{selectedTravelInfo.location || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-ink-3/75">Responsible</p>
                    <p className="mt-1">{selectedTravelInfo.responsible || "-"}</p>
                  </div>
                </div>
              )}
              {selectedDay && selectedDay.comp_mins > 0 && compSourceRows.length > 0 ? (
                <div className="mt-4 border-t border-glass/10 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.15em] text-ink-3/75">Compensation from</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="glass-quiet"
                        size="xs"
                        onClick={() => {
                          void handleCopyCompSourcesText();
                        }}
                      >
                        Copy Text
                      </Button>
                      <Button
                        variant="glass-quiet"
                        size="xs"
                        onClick={() => {
                          void handleCopyCompSourcesPng();
                        }}
                      >
                        Copy PNG
                      </Button>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-2 text-sm">
                    {compSourceRows.map((source) => (
                      <li key={source.date} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block">{dayLabel(source.date)}</span>
                          <span className="block text-xs text-ink-3/75">
                            {[source.client, source.location].filter(Boolean).join(" · ") || "No travel info"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block tabular-nums text-accent-soft/95">{fmtHM(source.mins)}</span>
                          <span className="block text-xs text-ink-3/75">of {fmtHM(source.earned)} overtime</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Off-screen, print-clean card captured by "Copy PNG". Kept laid
                      out (not display:none) so html-to-image can render it. */}
                  <div aria-hidden className="pointer-events-none fixed -left-[12000px] top-0">
                    <div
                      ref={exportCardRef}
                      className="w-[460px] overflow-hidden rounded-2xl border border-glass/20 p-6"
                      style={{
                        fontFamily: "var(--font-geist-sans), Arial, sans-serif",
                        // Opaque re-creation of the underwater glass panel:
                        // backdrop-filter can't be screenshotted, so the cyan
                        // glows + glass sheen are baked into solid gradients.
                        background:
                          "radial-gradient(26rem 16rem at 12% 6%, rgba(219,245,255,0.12), transparent 70%)," +
                          "radial-gradient(40rem 30rem at 16% 26%, rgba(34,211,238,0.16), transparent 65%)," +
                          "radial-gradient(36rem 26rem at 86% 88%, rgba(56,189,248,0.16), transparent 65%)," +
                          "linear-gradient(140deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02) 60%)," +
                          "linear-gradient(180deg, #0b1f2c, #061320)",
                        boxShadow:
                          "0 22px 48px rgba(6,17,36,0.5), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(255,255,255,0.08)",
                      }}
                    >
                      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent/80">
                        Time Tracker
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-ink">Compensation from</h3>
                      {selectedDay ? (
                        <p className="mt-0.5 text-sm text-ink-3/80">for {dayLabel(selectedDay.date)}</p>
                      ) : null}

                      <div className="mt-5 overflow-hidden rounded-xl border border-glass/15 bg-glass/[0.05]">
                        {compSourceRows.map((source, index) => (
                          <div
                            key={source.date}
                            className={`flex items-baseline justify-between gap-4 px-4 py-3 ${
                              index > 0 ? "border-t border-glass/10" : ""
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-ink">{dayLabel(source.date)}</p>
                              <p className="mt-0.5 text-xs text-ink-3/80">
                                {[source.client, source.location].filter(Boolean).join(" · ") || "No travel info"}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-semibold tabular-nums text-accent-soft">{fmtHM(source.mins)}</p>
                              <p className="mt-0.5 text-xs text-ink-3/80">of {fmtHM(source.earned)} overtime</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex items-baseline justify-between border-t border-glass/10 pt-3">
                        <span className="text-sm font-medium text-ink-3">Total compensated</span>
                        <span className="text-base font-semibold tabular-nums text-ink">{fmtHM(compTotalMins)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
