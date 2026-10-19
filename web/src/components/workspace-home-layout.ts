/**
 * Layout of the workspace home, shared by the real page
 * (`dashboard-shell.tsx`, `auth-navbar.tsx`) and its loading skeleton
 * (`app/dashboard/loading.tsx`). The skeleton is drawn from these same classes
 * and copy, so it lands exactly where the page will — change the home here and
 * the skeleton follows. Anything the home gains that is not in this file needs
 * a matching placeholder in `loading.tsx`.
 *
 * Plain constants (no "use client"): the skeleton is a server component.
 *
 * The `home-card*`, `beta-badge` and `navbar-logo` names are styling hooks for
 * the appearance skins (app/decorations.css re-skins them per data-mode);
 * they carry no styles of their own.
 */

/* The navbar is a positioned, isolated box; its card surface is a separate
 * absolutely-positioned child (NAVBAR_SURFACE_CLASS) so the launch camera can
 * hold the surface back while the title is on screen alone, and so the menu
 * dropdown escapes the card's overflow without an override. */
export const NAVBAR_CLASS = "relative isolate sticky top-3 z-[90] p-2.5 md:p-3";
/* `absolute!`: .glass-card sets position: relative in unlayered CSS, which
 * beats a plain utility; without the override the surface collapses to a
 * zero-size box and the navbar has no card at all. */
export const NAVBAR_SURFACE_CLASS = "glass-card absolute! inset-0 -z-1";
/* The brand title, everywhere it appears: navbar, phone home, login card and
 * the launch splash (which the camera lines up with it, so one class, one
 * copy of the text). The face is .brand-wordmark in app/animations.css. */
export const NAVBAR_TITLE = "The Flya Space";
// The app icon (public/icons, built from src/brand/flya-space-icon.svg) is a
// full-bleed square, so the corner radius and clipping come from here.
export const NAVBAR_LOGO_CLASS = "navbar-logo h-7 w-7 shrink-0 overflow-hidden rounded-md";
export const NAVBAR_LOGO_SRC = "/icons/icon-192.png";
export const NAVBAR_EYEBROW_CLASS = "text-[11px] uppercase tracking-[0.15em] text-accent-soft/70";
export const NAVBAR_TITLE_CLASS = "brand-wordmark mt-1 text-[11px] text-ink";
export const NAVBAR_MENU_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-1.5 text-xs transition ease-fluid hover:bg-glass/12";

/**
 * Fills the first screen, so Field stats start below the fold. Content sits at
 * the top, not centred: with two rows of cards, centring left a band of empty
 * page above the greeting.
 */
export const HOME_HERO_CLASS = "relative flex min-h-[calc(100svh-7rem)] flex-col justify-start pt-4 md:pt-8";
export const HOME_CONTENT_CLASS = "relative z-[1] mx-auto w-full max-w-5xl";
export const HOME_INTRO_CLASS = "mb-7 md:mb-9";
export const HOME_EYEBROW_CLASS = "text-[11px] font-medium uppercase tracking-[0.28em] text-accent-soft/65";
export const HOME_GREETING_CLASS =
  "mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-ink md:text-4xl lg:text-[2.65rem] lg:leading-[1.12]";
export const HOME_SUBTITLE_CLASS = "mt-3 max-w-lg text-pretty text-sm leading-relaxed text-ink-4 md:text-base";
export const HOME_SUBTITLE = "Open a module below and pick up right where you left off.";
export const HOME_ROLE_PILL_CLASS =
  "mt-4 inline-flex items-center rounded-full border border-glass/10 bg-glass/[0.06] px-3 py-1 text-[11px] font-medium tracking-wide text-ink-3";

/** At most three cards a row; the Google sheets and form wrap underneath. */
export function homeGridClass(cardCount: number): string {
  return `grid gap-4 ${cardCount >= 3 ? "md:grid-cols-3" : "sm:mx-auto sm:max-w-2xl sm:grid-cols-2"}`;
}

export const MODULE_CARD_CLASS =
  "home-card group relative flex flex-col overflow-hidden rounded-[1.4rem] border border-glass/[0.09] bg-glass/[0.04] p-1.5 text-left shadow-[var(--module-card-shadow)] transition duration-150 ease-fluid hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
export const MODULE_CARD_CORE_CLASS =
  "home-card-core relative flex flex-1 flex-col overflow-hidden rounded-[calc(1.4rem-0.375rem)] bg-gradient-to-br from-panel/95 via-surface/90 to-surface/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";
export const MODULE_CARD_ICON_CLASS = "home-card-icon mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border";
export const MODULE_CARD_TITLE_CLASS = "inline-flex items-center gap-2 text-lg font-semibold text-ink";
export const MODULE_CARD_DESCRIPTION_CLASS = "mt-2 text-sm leading-relaxed text-ink-4";
export const MODULE_CARD_CTA_CLASS = "home-card-cta mt-6 inline-flex items-center gap-2 text-xs font-semibold";
export const MODULE_CARD_ARROW_CLASS =
  "home-card-arrow grid h-6 w-6 place-items-center rounded-full border border-glass/15 bg-glass/10 transition ease-fluid group-hover:-translate-y-[1px] group-hover:translate-x-1";
export const BETA_BADGE_CLASS = "beta-badge rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-normal uppercase tracking-wider text-warn";

/**
 * The home's cards, in order. Time Tracker is always there; the rest depend on
 * the role (the Google sheets and form: pilots and admins only, and only once
 * their id is configured).
 */
export const HOME_CARDS = [
  { key: "mail", title: "Mail Composer", description: "Training email drafts and Gmail handoff in one flow.", beta: false },
  {
    key: "time",
    title: "Time Tracker",
    description: "Workdays, breaks, compensation time, and overtime in one place.",
    beta: false,
  },
  {
    key: "fleet",
    title: "Fleet",
    description: "Book drones and material by the day, and see who has what.",
    beta: true,
  },
  {
    key: "planning",
    title: "Mission planning",
    description: "The team planning sheet, live and editable, right here.",
    beta: false,
  },
  {
    key: "fleetsheet",
    title: "Fleet management",
    description: "The fleet management sheet, live and editable, right here.",
    beta: false,
  },
  {
    key: "roaddays",
    title: "Road Days",
    description: "Log your road days in the team form, right here.",
    beta: false,
  },
] as const;

/**
 * The open module's name in the header row above it ("← Workspace overview …
 * Time Tracker"), shared with the module skeletons in `loading.tsx`. Admin's
 * label depends on the role (`adminModuleLabel` in the shell); this is the
 * admin's own, which the skeleton uses before the role is known.
 */
export const MODULE_VIEW_LABELS = {
  mail: "Mail Composer",
  time: "Time Tracker",
  fleet: "Fleet (beta)",
  planning: HOME_CARDS[3].title,
  fleetsheet: HOME_CARDS[4].title,
  roaddays: HOME_CARDS[5].title,
  admin: "Admin",
  settings: "Settings",
} as const;

/** The row above an open module: the way back to the home on the left, the module's name on the right. */
export const MODULE_VIEW_HEADER_CLASS = "flex flex-wrap items-center justify-between gap-3 border-b border-glass/[0.07] pb-4";
export const MODULE_VIEW_BACK_CLASS =
  "group inline-flex items-center gap-2 rounded-xl border border-glass/10 bg-overlay/40 px-3.5 py-2 text-xs font-medium text-ink-3 shadow-sm shadow-shade/20 backdrop-blur-sm transition hover:border-accent/25 hover:bg-glass/[0.06] hover:text-ink";
export const MODULE_VIEW_LABEL_CLASS = "text-[11px] text-ink-5";

export const CHAT_PILL_CLASS =
  "fixed bottom-safe right-4 z-[125] inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/95 px-4 py-3 text-sm font-semibold text-slate-900 shadow-[0_18px_36px_-12px_rgba(34,211,238,0.55)] backdrop-blur transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
