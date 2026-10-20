"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import {
  QUARTER_HOURS,
  joinTime,
  nearestQuarterHour,
  padSegment,
  splitTime,
  stepSegment,
  typeDigit,
  type Segment,
} from "./time-field-parse";

type TimeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

const SEGMENT_LABEL: Record<Segment, string> = { h: "Hours", m: "Minutes" };

/**
 * A 24-hour time field built like the browser's own: an hours box and a
 * minutes box you type into (`--:--` when empty), arrow keys step them, the
 * clock button lists quarter hours. Replaces the native `type="time"` box in
 * the desktop Day Logger, which follows the computer's clock setting — on
 * 12-hour machines it showed AM/PM and people saved PM times they meant as AM.
 * The value commits as soon as both boxes hold a number; leaving the field
 * with only one filled puts the previous time back.
 */
export function TimeField({ value, onChange, disabled, "aria-label": ariaLabel }: TimeFieldProps) {
  const [parts, setParts] = useState(() => splitTime(value));
  const [syncedValue, setSyncedValue] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const segmentRefs = useRef<Record<Segment, HTMLSpanElement | null>>({ h: null, m: null });
  // True right after a box is entered: the next digit replaces, not appends.
  const freshRef = useRef(true);
  const listId = useId();

  // A new value from outside (another day opened, Reset day) replaces the
  // boxes, unless it is just the echo of what is being typed.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (joinTime(parts.h, parts.m) !== value) setParts(splitTime(value));
  }

  function update(next: { h: string; m: string }) {
    setParts(next);
    const joined = joinTime(next.h, next.m);
    if (joined !== null && joined !== value) onChange(joined);
  }

  function focusSegment(segment: Segment) {
    segmentRefs.current[segment]?.focus();
  }

  function handleKeyDown(segment: Segment, event: KeyboardEvent<HTMLSpanElement>) {
    const { key } = event;
    if (/^\d$/.test(key)) {
      event.preventDefault();
      const { text, done } = typeDigit(segment, parts[segment], freshRef.current, Number(key));
      freshRef.current = done;
      update({ ...parts, [segment]: text });
      if (done && segment === "h") focusSegment("m");
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      freshRef.current = true;
      update({ ...parts, [segment]: stepSegment(segment, parts[segment], key === "ArrowUp" ? 1 : -1) });
    } else if (key === "Backspace" || key === "Delete") {
      event.preventDefault();
      freshRef.current = true;
      if (parts[segment] === "" && segment === "m") focusSegment("h");
      else update({ ...parts, [segment]: "" });
    } else if (key === "ArrowRight" || key === ":" || key === ".") {
      event.preventDefault();
      if (segment === "h") focusSegment("m");
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      if (segment === "m") focusSegment("h");
    } else if (key === "Escape" && open) {
      // Close the list only; the window-level Escape closes the whole editor.
      event.stopPropagation();
      setOpen(false);
    }
  }

  // Leaving the field: pad a half-typed box, or put the old time back when
  // only one box is filled in.
  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (wrapRef.current?.contains(event.relatedTarget as Node | null)) return;
    const padded = { h: padSegment(parts.h), m: padSegment(parts.m) };
    if (joinTime(padded.h, padded.m) === null) setParts(splitTime(value));
    else update(padded);
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

  function renderSegment(segment: Segment) {
    const text = parts[segment];
    return (
      <span
        ref={(node) => {
          segmentRefs.current[segment] = node;
        }}
        role="spinbutton"
        aria-label={ariaLabel ? `${ariaLabel} ${SEGMENT_LABEL[segment].toLowerCase()}` : SEGMENT_LABEL[segment]}
        aria-valuemin={0}
        aria-valuemax={segment === "h" ? 23 : 59}
        aria-valuenow={text === "" ? undefined : Number(text)}
        aria-valuetext={text === "" ? "Empty" : text}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onFocus={() => {
          freshRef.current = true;
        }}
        onKeyDown={(event) => handleKeyDown(segment, event)}
        className={cn(
          "inline-block min-w-[2ch] rounded px-0.5 text-center outline-none",
          "focus:bg-accent focus:text-white",
          text === "" && "text-ink-3/80",
        )}
      >
        {text === "" ? "--" : text}
      </span>
    );
  }

  return (
    <div
      ref={wrapRef}
      onBlur={handleBlur}
      className={cn(
        "relative flex w-full items-center rounded-lg border border-glass/15 bg-glass/10 py-2 pl-3 pr-10 text-base tabular-nums sm:text-sm",
        "focus-within:border-accent/40",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-text",
      )}
      onMouseDown={(event) => {
        // A click on the empty part of the box goes to the hours, like the native field.
        if (disabled || event.target !== event.currentTarget) return;
        event.preventDefault();
        focusSegment(parts.h === "" || parts.m !== "" ? "h" : "m");
      }}
    >
      {renderSegment("h")}
      <span className="px-0.5" aria-hidden>
        :
      </span>
      {renderSegment("m")}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Pick a time"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-ink-3 transition hover:text-ink disabled:pointer-events-none"
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
          className="absolute right-0 top-full z-20 mt-1.5 max-h-56 w-32 cursor-default overflow-y-auto rounded-xl border border-glass/15 bg-panel p-1 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)] ring-1 ring-glass/5"
        >
          {QUARTER_HOURS.map((time) => {
            const selected = time === value;
            return (
              <li key={time} role="option" aria-selected={selected} data-time={time}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    update(splitTime(time));
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
