"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui";
import {
  QUARTER_HOURS,
  nearestQuarterHour,
  parseTimeLive,
  parseTimeOnBlur,
  sanitizeTimeDraft,
  stepTime,
} from "./time-field-parse";

type TimeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * A 24-hour `HH:MM` field that looks the same in every browser. Replaces the
 * native `type="time"` box in the desktop Day Logger: that one follows the
 * computer's clock setting, and on 12-hour machines people kept saving PM
 * times they meant as AM. Typing commits as soon as the draft is a full time;
 * blur fills in short forms (`7` → 07:00, `730` → 07:30) or reverts nonsense.
 * Arrow keys move by 15 minutes; the clock button opens a quarter-hour list.
 */
export function TimeField({ value, onChange, disabled, "aria-label": ariaLabel }: TimeFieldProps) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // A new value from outside (another day opened, Reset day) replaces the
  // draft, unless it is just the echo of what is being typed.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseTimeLive(draft) !== value) setDraft(value);
  }

  function commit(next: string) {
    setDraft(next);
    if (next !== value) onChange(next);
  }

  function handleBlur() {
    if (draft.trim() === "") {
      if (value !== "") onChange("");
      return;
    }
    const parsed = parseTimeOnBlur(draft);
    if (parsed) commit(parsed);
    else setDraft(value);
  }

  // Close the list on a click anywhere else.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Open the list scrolled to the current time.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-time="${nearestQuarterHour(value)}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [open, value]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="--:--"
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        className="pr-10 tabular-nums tracking-wide"
        onChange={(event) => {
          const next = sanitizeTimeDraft(event.target.value);
          setDraft(next);
          // An emptied field commits on blur, so retyping keeps the old time
          // to fall back on if the new draft turns out to be nonsense.
          const parsed = parseTimeLive(next);
          if (parsed && parsed !== value) onChange(parsed);
        }}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            commit(stepTime(parseTimeOnBlur(draft) ?? value, event.key === "ArrowUp" ? 15 : -15));
          } else if (event.key === "Enter") {
            handleBlur();
          } else if (event.key === "Escape" && open) {
            // Close the list only; the window-level Escape closes the whole editor.
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Pick a time"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-ink-3 transition hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Times"
          className="absolute right-0 top-full z-20 mt-1.5 max-h-56 w-32 overflow-y-auto rounded-xl border border-glass/15 bg-panel p-1 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)] ring-1 ring-glass/5"
        >
          {QUARTER_HOURS.map((time) => {
            const selected = time === value;
            return (
              <li key={time} role="option" aria-selected={selected} data-time={time}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    commit(time);
                    setOpen(false);
                  }}
                  className={`w-full rounded-lg px-3 py-1.5 text-left text-sm tabular-nums transition ${
                    selected ? "bg-accent/15 text-ink" : "text-ink-2 hover:bg-glass/8"
                  }`}
                >
                  {time}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
