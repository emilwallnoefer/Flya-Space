/**
 * The phone home header's boxes, shared by the real header (MobileHomeHeader
 * in primitives.tsx) and the route skeleton (mobile-skeleton.tsx), so the
 * page lands where the placeholders were drawn. No "use client" here: the
 * skeleton is a server component and must read these as plain strings.
 *
 * Shape, after the desktop (workspace-home-layout.ts): a navbar card (the
 * app icon, the eyebrow over the wordmark, the avatar on the right), some
 * air, then the greeting block (its eyebrow, "Good afternoon, Emil"). The
 * card sticks to the top like the desktop's; the greeting scrolls away.
 * Change the header's layout here, never inline.
 */
export const MOBILE_HOME_NAVBAR_CLASS = "sticky top-[max(0.75rem,var(--safe-top))] z-30 mx-4 isolate";
/* The card itself, a sibling under the row so the launch camera can hold it
 * back while the title stands alone (a "surface" reveal, like the desktop). */
export const MOBILE_HOME_NAVBAR_SURFACE_CLASS = "m-tile absolute inset-0 -z-1 rounded-2xl border border-glass/10 bg-panel";
export const MOBILE_HOME_NAVBAR_ROW_CLASS = "flex items-center justify-between gap-3 p-2.5";
export const MOBILE_HOME_NAVBAR_BRAND_CLASS = "flex min-w-0 items-center gap-2.5";
export const MOBILE_HOME_INTRO_CLASS = "px-4 pb-2 pt-7";
export const MOBILE_HOME_EYEBROW_CLASS = "text-[11px] font-medium uppercase tracking-[0.28em] text-accent-soft/65";
export const MOBILE_HOME_GREETING_CLASS = "mt-2 text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-ink";
/* Space above the navbar card, matching the page's safe top. */
export const MOBILE_HOME_SCREEN_TOP_CLASS = "pt-[max(0.75rem,var(--safe-top))]";
