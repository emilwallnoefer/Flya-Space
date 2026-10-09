import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Shared form-control chrome (the app's standard input/select/textarea look).
 * 16px on phones, 14px from `sm` up: iOS zooms into any focused control
 * smaller than 16px (tokens.css has a base-layer backstop for raw elements).
 */
const FIELD_CHROME =
  "w-full rounded-lg border border-glass/15 bg-glass/10 px-3 py-2 text-base sm:text-sm focus-visible:border-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent/50";

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input className={cn(FIELD_CHROME, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return <select className={cn(FIELD_CHROME, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea className={cn(FIELD_CHROME, className)} {...props} />;
}
