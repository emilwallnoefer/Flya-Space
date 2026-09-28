import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "glass" // default secondary action: glass chip with lift-on-hover
  | "glass-quiet" // glass chip without the hover lift (dense rows, toolbars)
  | "accent" // primary action: solid accent fill, dark text
  | "accent-outline" // emphasized secondary: accent border + deep tint
  | "ghost" // bare text button, glass tint on hover
  | "danger"; // destructive action

export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  glass:
    "border border-glass/20 bg-glass/10 font-medium transition hover:-translate-y-px hover:bg-glass/15 disabled:translate-y-0 disabled:opacity-60",
  "glass-quiet":
    "border border-glass/20 bg-glass/10 transition hover:bg-glass/15 disabled:opacity-60",
  accent:
    "bg-accent/90 font-medium text-slate-900 transition hover:-translate-y-px hover:bg-accent disabled:translate-y-0 disabled:opacity-60",
  "accent-outline":
    "border border-accent/45 bg-accent-deep/15 font-semibold text-accent-soft transition hover:-translate-y-px hover:bg-accent-deep/25 disabled:translate-y-0 disabled:opacity-60",
  ghost: "text-ink-2 transition hover:bg-glass/10 disabled:opacity-60",
  danger:
    "border border-rose-300/45 bg-rose-500/20 font-medium text-danger transition hover:bg-rose-500/30 disabled:opacity-60",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "rounded-md px-2 py-1 text-[11px]",
  sm: "rounded-lg px-3 py-2 text-xs",
  md: "rounded-lg px-3 py-2 text-sm",
  lg: "rounded-lg px-4 py-2.5 text-sm",
};

/** Shared keyboard-focus affordance (matches the composer segments' accent outline). */
const FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/80";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "glass", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("ease-fluid", SIZE_CLASSES[size], VARIANT_CLASSES[variant], FOCUS_CLASSES, className)}
      {...props}
    />
  );
}

export type ButtonLinkProps = ComponentPropsWithRef<"a"> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Anchors cannot be disabled, so a disabled ButtonLink renders a disabled Button. */
  disabled?: boolean;
};

/**
 * Button styling on a plain `<a>`, for actions that are a full document load by
 * design: a file download from an API route, or leaving an error boundary for a
 * fresh copy of the page. In-app navigation belongs to `next/link`.
 */
export function ButtonLink({ variant = "glass", size = "md", disabled, className, children, ...props }: ButtonLinkProps) {
  if (disabled) {
    return (
      <Button variant={variant} size={size} className={className} disabled>
        {children}
      </Button>
    );
  }
  return (
    <a
      className={cn("ease-fluid inline-block text-center", SIZE_CLASSES[size], VARIANT_CLASSES[variant], FOCUS_CLASSES, className)}
      {...props}
    >
      {children}
    </a>
  );
}
