/**
 * The phone home header's boxes, shared by the real header (MobileHomeHeader
 * in primitives.tsx) and the route skeleton (mobile-skeleton.tsx), so the
 * page lands where the placeholders were drawn. No "use client" here: the
 * skeleton is a server component and must read these as plain strings.
 *
 * Shape: a brand row (the wordmark on the left, the avatar on the right,
 * centred on each other), then the greeting and the name as the page's
 * large title. Change the header's layout here, never inline.
 */
export const MOBILE_HOME_HEADER_CLASS = "px-4 pb-3 pt-[max(0.75rem,var(--safe-top))]";
export const MOBILE_HOME_BRAND_ROW_CLASS = "flex h-10 items-center justify-between gap-3";
/** The wordmark class carries mt-1 (its navbar offset); the bottom padding balances it. */
export const MOBILE_HOME_BRAND_CLASS = "flex min-w-0 items-center pb-1";
export const MOBILE_HOME_GREETING_CLASS = "mt-4 block text-[15px] font-medium leading-5 text-ink-3";
export const MOBILE_HOME_NAME_CLASS = "mt-0.5 block truncate text-[2.125rem] font-bold leading-[1.1] tracking-[-0.02em] text-ink";
