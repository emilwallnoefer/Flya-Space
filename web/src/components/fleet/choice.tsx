"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input } from "@/components/ui";

/**
 * Pick-one controls, for the fields where typing was never the point.
 *
 * Manage used to be eleven text boxes and two dropdowns. Most of those fields
 * have a handful of real answers that already exist in the data — the same six
 * locations, the same four owner groups, the same dozen people — so typing them
 * meant retyping them, and retyping them meant "EMEA", "emea" and "EMEA " all
 * became different places. Offering what already exists fixes the spelling
 * problem and the speed problem at once.
 *
 * A free-text escape stays on every open-ended field, because the fleet does go
 * somewhere new. Only the closed sets (type, status, pooled) have none.
 */

/** One option in a chip group. */
export type Choice<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Shown under the label — for the two or three options that need a why. */
  hint?: string;
};

function chipClass(selected: boolean): string {
  return [
    "choice-chip inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ease-fluid",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent/80",
    selected
      ? "border-accent/50 bg-accent-deep/30 text-accent-soft"
      : "border-glass/12 bg-glass/[0.05] text-ink-3 hover:border-glass/25 hover:bg-glass/10 hover:text-ink",
  ].join(" ");
}

/**
 * A row of chips where exactly one is chosen.
 *
 * `radiogroup` rather than a listbox or a pile of buttons: that is what it is,
 * and it gives arrow-key movement and a single tab stop for free in screen
 * readers without re-implementing either.
 */
export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  columns,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<Choice<T>>;
  onChange: (value: T) => void;
  /** Lay the chips out as a grid instead of a wrapping row. */
  columns?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-ink-3/75">{label}</legend>
      <div
        role="radiogroup"
        aria-label={label}
        className={columns ? "grid gap-1.5 sm:grid-cols-2" : "flex flex-wrap gap-1.5"}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`${chipClass(selected)} ${option.hint ? "flex-col !items-start gap-0.5 text-left" : ""}`}
            >
              <span className="flex items-center gap-1.5">
                {option.icon}
                {option.label}
              </span>
              {option.hint ? (
                <span className="text-[11px] font-normal text-ink-5">{option.hint}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Chips for the answers that already exist, and a box for the one that does not.
 *
 * The text box is not rendered until it is asked for. A field that shows six
 * known locations AND an empty input is offering two ways to do the same thing,
 * and the input is the one that introduces the seventh spelling of "Lausanne".
 */
export function ChoiceOrCustom({
  label,
  value,
  options,
  onChange,
  placeholder,
  allowEmpty = false,
  emptyLabel = "None",
}: {
  label: string;
  value: string;
  /** Values already in use, in the order they should be offered. */
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Offer an explicit "no value" chip. */
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  // A value that is not one of the known options is already a custom one, so
  // the box opens holding it rather than making the user find that out.
  const isKnown = value === "" ? allowEmpty : options.includes(value);
  const [custom, setCustom] = useState(!isKnown && value !== "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (custom) inputRef.current?.focus();
  }, [custom]);

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-ink-3/75">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {allowEmpty ? (
          <button
            type="button"
            onClick={() => {
              setCustom(false);
              onChange("");
            }}
            aria-pressed={!custom && value === ""}
            className={chipClass(!custom && value === "")}
          >
            {emptyLabel}
          </button>
        ) : null}

        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(option);
            }}
            aria-pressed={!custom && value === option}
            className={chipClass(!custom && value === option)}
          >
            {option}
          </button>
        ))}

        <button
          type="button"
          onClick={() => {
            // Start the custom entry empty rather than inheriting the chip that
            // was selected — you opened this to type something else.
            if (!custom) onChange("");
            setCustom(true);
          }}
          aria-pressed={custom}
          aria-expanded={custom}
          className={chipClass(custom)}
        >
          + Other
        </button>
      </div>

      {custom ? (
        <div className="mt-1.5">
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCustom(false);
                onChange("");
              }
            }}
            placeholder={placeholder}
            className="px-2 py-1.5 text-xs"
            aria-label={label}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
