"use client";

import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeFloating, type FloatAlign, type FloatRect, type FloatSide } from "@/lib/floating-position";

const HIDDEN_UNTIL_PLACED = { visibility: "hidden" } as const;

/**
 * A tooltip or hover card drawn on `document.body`, not inside its card.
 * Cards clip what sticks out (`overflow-hidden`), and the glass skins'
 * `backdrop-filter` turns them into the containing block of `position: fixed`
 * too — so anything floating has to leave the card's subtree to stay whole.
 * `anchor` is re-read on every render, scroll and resize, so the box follows
 * its trigger; placement rules live in `lib/floating-position.ts`.
 */
export function Floating({
  anchor,
  side = "bottom",
  align = "center",
  gap,
  className = "",
  children,
  ...rest
}: {
  anchor: () => FloatRect | null;
  side?: FloatSide;
  align?: FloatAlign;
  gap?: number;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children" | "style">) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const placeRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const place = () => {
      const box = boxRef.current;
      const rect = anchor();
      if (!box || !rect) return;
      const pos = placeFloating({
        anchor: rect,
        size: { width: box.offsetWidth, height: box.offsetHeight },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        side,
        align,
        gap,
      });
      box.style.left = `${pos.left}px`;
      box.style.top = `${pos.top}px`;
      box.style.visibility = "visible";
    };
    placeRef.current = place;
    place();
  });

  useEffect(() => {
    const follow = () => placeRef.current();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, []);

  return createPortal(
    <div
      ref={boxRef}
      {...rest}
      style={HIDDEN_UNTIL_PLACED}
      className={`pointer-events-none fixed left-0 top-0 z-[100] max-w-[calc(100vw-16px)] ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
