"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Floating } from "@/components/floating";

export function InfoTooltip({
  children,
  label = "More info",
  align = "start",
}: {
  children: ReactNode;
  label?: string;
  align?: "start" | "center" | "end";
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const id = useId();
  const open = hovered || focused;
  return (
    <span
      className="relative inline-flex items-center"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <span
        ref={triggerRef}
        role="img"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setHovered(false);
            setFocused(false);
          }
        }}
        className="inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-glass/20 bg-glass/5 text-[11px] font-medium text-ink-3 transition hover:bg-glass/15 focus:outline-none focus:ring-1 focus:ring-amber-300/40"
      >
        i
      </span>
      {open ? (
        <Floating
          id={id}
          role="tooltip"
          anchor={() => triggerRef.current?.getBoundingClientRect() ?? null}
          align={align}
          className="w-64 rounded-lg border border-glass/10 bg-panel/95 px-3 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-ink-2 shadow-xl"
        >
          {children}
        </Floating>
      ) : null}
    </span>
  );
}
