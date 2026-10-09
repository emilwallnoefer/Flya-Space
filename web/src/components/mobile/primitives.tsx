"use client";

import { AnimatePresence, m } from "framer-motion";
import { type ReactNode, useEffect, useRef } from "react";
import { lockPageScroll } from "@/lib/scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { cn } from "@/lib/cn";

/**
 * The phone UI's building blocks. Native-app shaped: a top bar with a back
 * button, grouped lists with chevrons, tiles, segmented controls and bottom
 * sheets. Everything uses the semantic tokens only (surface / panel / raised,
 * glass hairlines, the ink ladder, the accent), so each skin re-colours them
 * for free; `app/mobile.css` keys the two looks on `data-mobile-look`.
 */

/* ------------------------------------------------------------------ top bar */

export function MobileTopBar({
  title,
  onBack,
  right,
  large = false,
}: {
  title: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  /** Home-style: a bigger title with room for a subtitle under it. */
  large?: boolean;
}) {
  return (
    <header className="m-topbar sticky top-0 z-30 flex items-center gap-2 bg-surface/95 px-3 pb-2 pt-[max(0.5rem,var(--safe-top))] backdrop-blur-md">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-accent-soft active:bg-glass/10"
        >
          <ChevronIcon className="h-5 w-5 rotate-180" />
        </button>
      ) : (
        <span className="w-1" aria-hidden />
      )}
      <h1 className={cn("min-w-0 flex-1 truncate font-semibold text-ink", large ? "text-2xl" : "text-base")}>{title}</h1>
      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </header>
  );
}

/* ---------------------------------------------------------------- grouped list */

export function MobileGroup({
  title,
  children,
  className,
  trailing,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <section className={cn("m-group", className)}>
      {title || trailing ? (
        <div className="mb-1.5 flex items-baseline justify-between px-1">
          {title ? <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">{title}</h2> : <span />}
          {trailing}
        </div>
      ) : null}
      <div className="m-group-body divide-y divide-glass/10 overflow-hidden rounded-2xl border border-glass/10 bg-panel">
        {children}
      </div>
    </section>
  );
}

export function MobileRow({
  icon,
  label,
  detail,
  value,
  chevron = false,
  onClick,
  href,
  tone,
  disabled,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  /** A full navigation to another page (onboarding), as a real link. */
  href?: string;
  tone?: "accent" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {icon ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-glass/8 text-accent-soft">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px]", tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent-soft" : "text-ink")}>
          {label}
        </span>
        {detail ? <span className="mt-0.5 block truncate text-xs text-ink-4">{detail}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-sm tabular-nums text-ink-3">{value}</span> : null}
      {chevron ? <ChevronIcon className="h-4 w-4 shrink-0 text-ink-5" /> : null}
    </>
  );
  const classes = cn("flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left", (onClick || href) && !disabled && "active:bg-glass/8", disabled && "opacity-50", className);
  if (href) {
    return (
      <a href={href} className={classes}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/* ------------------------------------------------------------------- tiles */

export function MobileTile({
  label,
  value,
  detail,
  onClick,
  tone = "default",
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  onClick?: () => void;
  tone?: "default" | "accent" | "positive" | "warn";
  icon?: ReactNode;
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent-soft"
      : tone === "positive"
        ? "text-positive"
        : tone === "warn"
          ? "text-warn"
          : "text-ink";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "m-tile flex min-h-[5.5rem] flex-col justify-between rounded-2xl border border-glass/10 bg-panel p-3.5 text-left",
        onClick && "active:bg-glass/8",
      )}
    >
      <span className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-4">
        {label}
        {icon ? <span className="text-ink-5">{icon}</span> : null}
      </span>
      <span>
        <span className={cn("block text-2xl font-semibold tabular-nums leading-tight", toneClass)}>{value}</span>
        {detail ? <span className="mt-0.5 block text-xs text-ink-4">{detail}</span> : null}
      </span>
    </Tag>
  );
}

/* ------------------------------------------------------------- segmented */

export function MobileSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="m-segmented grid gap-1 rounded-xl bg-glass/8 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-9 rounded-lg px-2 text-sm font-medium transition",
              active ? "bg-raised text-ink shadow-sm" : "text-ink-4 active:text-ink-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- buttons */

export function MobileButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const look =
    variant === "primary"
      ? "bg-accent text-slate-950 active:bg-accent-deep"
      : variant === "danger"
        ? "bg-rose-500/15 text-danger border border-rose-400/30 active:bg-rose-500/25"
        : variant === "ghost"
          ? "text-accent-soft active:bg-glass/8"
          : "border border-glass/15 bg-glass/8 text-ink active:bg-glass/12";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn("inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition disabled:opacity-50", look, className)}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ sheet */

/**
 * Bottom sheet. Slides up, pins the page behind it, follows the visual
 * viewport so its footer stays above the keyboard, closes on the scrim, the
 * grab handle or Back (the caller pushes history and listens to popstate).
 */
export function MobileSheet({
  open,
  onClose,
  title,
  children,
  footer,
  full = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Take the whole screen (an editor) instead of hugging the content. */
  full?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewport = useVisualViewport(open);
  useFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    return lockPageScroll();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <m.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[140] bg-overlay/60"
            onClick={onClose}
            aria-hidden
          />
          <m.div
            key="sheet"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_event, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) onClose();
            }}
            style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}
            className={cn(
              "m-sheet fixed inset-x-0 bottom-0 z-[141] flex flex-col rounded-t-3xl border-t border-glass/10 bg-panel shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.6)]",
              full ? "top-[max(0.75rem,var(--safe-top))]" : "max-h-[88dvh]",
            )}
          >
            <div className="flex shrink-0 items-center px-4 pb-1 pt-2" onClick={onClose} role="presentation">
              <span className="mx-auto h-1.5 w-10 rounded-full bg-glass/25" aria-hidden />
            </div>
            {title ? (
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2">
                <h2 className="text-base font-semibold text-ink">{title}</h2>
                <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-ink-4 active:bg-glass/10">
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 [touch-action:pan-y]">{children}</div>
            {footer ? <div className="shrink-0 border-t border-glass/10 px-4 pt-3 pb-[max(0.75rem,var(--safe-bottom))]">{footer}</div> : null}
          </m.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------- misc */

export function MobileEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-ink-4">{children}</p>;
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
