import type { CSSProperties } from "react";
import Image from "next/image";
import { headers } from "next/headers";
import { MobileSkeleton } from "@/components/mobile/mobile-skeleton";
import { isPhoneRequest } from "@/lib/device";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { parseRequestUrl, REQUEST_URL_HEADER, requestedDashboardModule } from "@/lib/launch-route";
import {
  BETA_BADGE_CLASS,
  CHAT_PILL_CLASS,
  HOME_CARDS,
  HOME_CONTENT_CLASS,
  HOME_EYEBROW_CLASS,
  HOME_GREETING_CLASS,
  HOME_HERO_CLASS,
  HOME_INTRO_CLASS,
  HOME_ROLE_PILL_CLASS,
  HOME_SUBTITLE,
  HOME_SUBTITLE_CLASS,
  homeGridClass,
  MODULE_CARD_ARROW_CLASS,
  MODULE_CARD_CLASS,
  MODULE_CARD_CORE_CLASS,
  MODULE_CARD_CTA_CLASS,
  MODULE_CARD_DESCRIPTION_CLASS,
  MODULE_CARD_ICON_CLASS,
  MODULE_CARD_TITLE_CLASS,
  MODULE_VIEW_BACK_CLASS,
  MODULE_VIEW_HEADER_CLASS,
  MODULE_VIEW_LABEL_CLASS,
  MODULE_VIEW_LABELS,
  NAVBAR_CLASS,
  NAVBAR_EYEBROW_CLASS,
  NAVBAR_LOGO_CLASS,
  NAVBAR_LOGO_SRC,
  NAVBAR_MENU_BUTTON_CLASS,
  NAVBAR_SURFACE_CLASS,
  NAVBAR_TITLE,
  NAVBAR_TITLE_CLASS,
} from "@/components/workspace-home-layout";

/**
 * Route-level skeleton for the dashboard. Two shapes, chosen from the request
 * URL the proxy forwards (lib/launch-route.ts):
 *
 * - The workspace home, drawn from the same layout classes and copy as the
 *   real page (`workspace-home-layout.ts`), so every block sits exactly where
 *   it will land. Text is the real text made transparent over a placeholder
 *   bar, which keeps line heights and wrapping identical. The greeting and
 *   role are not known yet, so they use stand-ins of typical length. It
 *   assumes the six-card home that pilots and admins see (Mail, Time, Fleet,
 *   then Mission planning, Fleet management and Road Days underneath). This
 *   is the page the launch camera opens on, so it carries the camera's
 *   target and reveal marks.
 *
 * - A module, when the reload carries `?module=`: the same navbar, the
 *   "← Workspace overview" row, and a placeholder in the shape of that
 *   module's panel. No splash plays over it (the root layout decides that
 *   from the same URL), so the skeleton is what the person sees until the
 *   panel streams in, and it has to look like the panel.
 *
 * The pulse is gated behind `motion-safe:` and ends when the page arrives.
 */

/** Real text, invisible, on a placeholder bar that wraps line by line. */
function Bar({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-glass/10 text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
      {children}
    </span>
  );
}

/** A block placeholder; the shape is the caller's. */
function Box({ className }: { className: string }) {
  return <span className={`block ${className}`} aria-hidden />;
}

/** The navbar, as the real one (auth-navbar.tsx): the one place the camera target lives on this page. */
function SkeletonNavbar() {
  return (
    <div className={`${NAVBAR_CLASS} motion-safe:animate-pulse`}>
      <div className={NAVBAR_SURFACE_CLASS} data-launch-reveal="surface" style={{ "--reveal-i": 0 } as CSSProperties} aria-hidden />
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex items-center gap-2.5">
          <Image src={NAVBAR_LOGO_SRC} alt="" width={28} height={28} className={NAVBAR_LOGO_CLASS} priority data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties} />
          <div className="min-w-0">
            <p className={NAVBAR_EYEBROW_CLASS} data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties}>Flyability Internal</p>
            <p className={NAVBAR_TITLE_CLASS} data-launch-target>{NAVBAR_TITLE}</p>
          </div>
        </div>
        <span className={`${NAVBAR_MENU_BUTTON_CLASS} text-transparent`} data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties}>
          <span className="hidden sm:inline">Menu</span>
          <span className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export default async function DashboardLoading() {
  // Same split as app/dashboard/page.tsx, so the skeleton is drawn for the
  // shell that is about to arrive. Loading UI renders inside the request (the
  // root layout already reads headers()), so the User-Agent and the proxy's
  // URL header are both available.
  const requestHeaders = await headers();
  const url = parseRequestUrl(requestHeaders.get(REQUEST_URL_HEADER));
  const openModule = url ? requestedDashboardModule(url.search) : null;
  if (isPhoneRequest(requestHeaders)) return <MobileSkeleton module={openModule} />;
  if (openModule) return <ModuleSkeleton module={openModule} />;
  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-surface text-ink" aria-busy="true">
      <div className="absolute inset-0 aurora-bg" data-launch-reveal="surface" style={{ "--reveal-i": 0 } as CSSProperties} />
      <section className="page-shell">
        {/* Navbar and hero are direct children of the page shell, like on the
            real page, so the shell's flex gap spaces them the same way. */}
        <SkeletonNavbar />

        <div className={`${HOME_HERO_CLASS} motion-safe:animate-pulse`}>
          <div className="dashboard-mesh" aria-hidden data-launch-reveal="surface" style={{ "--reveal-i": 1 } as CSSProperties} />
          <div className="dashboard-mesh-fade" aria-hidden data-launch-reveal="surface" style={{ "--reveal-i": 1 } as CSSProperties} />
          <div className={HOME_CONTENT_CLASS}>
            <div className={HOME_INTRO_CLASS} data-launch-reveal style={{ "--reveal-i": 1 } as CSSProperties}>
              <p className={HOME_EYEBROW_CLASS}>
                <Bar>Workspace</Bar>
              </p>
              <h1 className={HOME_GREETING_CLASS}>
                <Bar>Good morning, Emil</Bar>
              </h1>
              <p className={HOME_SUBTITLE_CLASS}>
                <Bar>{HOME_SUBTITLE}</Bar>
              </p>
              <span className={`${HOME_ROLE_PILL_CLASS} text-transparent!`}>EU Pilot</span>
            </div>

            <div className={homeGridClass(HOME_CARDS.length)}>
              {HOME_CARDS.map((card, index) => (
                <div key={card.key} className={MODULE_CARD_CLASS} data-launch-reveal style={{ "--reveal-i": 2 + index } as CSSProperties}>
                  <span className={MODULE_CARD_CORE_CLASS}>
                    <span className={`${MODULE_CARD_ICON_CLASS} border-glass/10 bg-glass/10`} />
                    <span className={MODULE_CARD_TITLE_CLASS}>
                      <Bar>{card.title}</Bar>
                      {card.beta ? <span className={`${BETA_BADGE_CLASS} bg-glass/10! text-transparent!`}>Beta</span> : null}
                    </span>
                    <span className={MODULE_CARD_DESCRIPTION_CLASS}>
                      <Bar>{card.description}</Bar>
                    </span>
                    <span className={`${MODULE_CARD_CTA_CLASS} text-transparent`}>
                      <Bar>Continue</Bar>
                      <span className={MODULE_CARD_ARROW_CLASS} />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <span className={`${CHAT_PILL_CLASS} pointer-events-none border-glass/15! bg-glass/10! text-transparent! shadow-none!`} aria-hidden data-launch-late>
          <span className="h-5 w-5" />
          <span className="hidden sm:inline">Team chat</span>
        </span>
        <span className="sr-only">Loading your workspace…</span>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------- module views */

const EMBED_MODULES: ReadonlySet<ModuleKey> = new Set(["planning", "fleetsheet", "roaddays"]);

/**
 * The dashboard with a module open, as the shell draws it: navbar, the header
 * row with the way back and the module's name, then the panel. The Google
 * embeds are full-window panels of their own (google-embed-panel.tsx) that
 * cover the page, so for them only the frame placeholder is drawn.
 */
function ModuleSkeleton({ module }: { module: ModuleKey }) {
  if (EMBED_MODULES.has(module)) {
    return (
      <main className="relative min-h-dvh bg-surface text-ink" aria-busy="true">
        <EmbedSkeleton title={MODULE_VIEW_LABELS[module]} />
        <span className="sr-only">Loading {MODULE_VIEW_LABELS[module]}…</span>
      </main>
    );
  }
  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-surface text-ink" aria-busy="true">
      <div className="absolute inset-0 aurora-bg" />
      <section className="page-shell">
        <SkeletonNavbar />
        <div className={`${MODULE_VIEW_HEADER_CLASS} motion-safe:animate-pulse`}>
          <span className={`${MODULE_VIEW_BACK_CLASS} text-transparent`}>
            <span aria-hidden>←</span>
            Workspace overview
          </span>
          <p className={MODULE_VIEW_LABEL_CLASS}>
            <Bar>{MODULE_VIEW_LABELS[module]}</Bar>
          </p>
        </div>
        <section className="space-y-4 motion-safe:animate-pulse">
          {module === "time" ? (
            <TimeSkeleton />
          ) : module === "mail" ? (
            <MailSkeleton />
          ) : module === "fleet" ? (
            <FleetSkeleton />
          ) : module === "admin" ? (
            <RailSkeleton title="Admin" />
          ) : module === "settings" ? (
            <RailSkeleton title="Settings" />
          ) : null}
        </section>
        <span className="sr-only">Loading {MODULE_VIEW_LABELS[module]}…</span>
      </section>
    </main>
  );
}

/** Panel chrome shared by Time, Admin and Settings: the underwater panel with its glass card. */
function Panel({ children, className = "p-4 md:p-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className="underwater-panel relative overflow-hidden rounded-2xl">
      <div className="relative min-h-0 min-w-0 w-full">
        <div className={`glass-card hourlogger-surface relative z-[1] w-full min-w-0 overflow-hidden rounded-2xl ${className}`}>{children}</div>
      </div>
    </section>
  );
}

/** Hour Logger: eyebrow and title, the week buttons, two total pills, then the week's day cards (5 + 2). */
function TimeSkeleton() {
  return (
    <Panel>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em]">
            <Bar>Time Tracker</Bar>
          </p>
          <h2 className="text-lg font-semibold md:text-xl">
            <Bar>Hour Logger</Bar>
          </h2>
        </div>
        <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
          <Box className="h-9 w-10 rounded-lg border border-glass/20 bg-glass/10" />
          {["Prev week", "Today", "Next week"].map((label) => (
            <span key={label} className="flex-1 rounded-lg border border-glass/20 bg-glass/10 px-3 py-2 text-xs text-transparent sm:flex-none">
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-3">
        {["Weekly hours:", "Overtime bank:"].map((label) => (
          <span key={label} className="flex items-center justify-between gap-3 rounded-full border border-glass/20 bg-glass/10 px-3 py-1.5 text-transparent">
            <span>{label}</span>
            <span className="inline-block min-w-[8ch]">0h 00m</span>
          </span>
        ))}
      </div>
      <div className="mt-5 space-y-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <DayCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <DayCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function DayCardSkeleton() {
  return (
    <div className="liquid-day-card rounded-xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <Box className="h-4 w-20 rounded bg-glass/10" />
          <Box className="h-3 w-14 rounded bg-glass/10" />
        </div>
        <Box className="h-5 w-12 rounded-full bg-glass/10" />
      </div>
      <Box className="mt-4 h-3 w-24 rounded bg-glass/10" />
      <Box className="mt-2 h-3 w-16 rounded bg-glass/10" />
    </div>
  );
}

/** Mail Composer: the form column on the left (340px on large screens), the live preview on the right. */
function MailSkeleton() {
  return (
    <section className="underwater-panel relative grid items-start gap-6 overflow-hidden rounded-2xl lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="relative min-h-0 min-w-0 w-full lg:col-start-1 lg:row-start-1">
        <div className="glass-card hourlogger-surface relative z-[1] w-full min-w-0 rounded-2xl p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold md:text-xl">
              <Bar>Mail Composer</Bar>
            </h2>
            <Box className="h-7 w-32 rounded-lg border border-glass/15 bg-glass/10" />
          </div>
          <div className="mt-5 space-y-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <Box className="h-3 w-24 rounded bg-glass/10" />
                <Box className={`${i === 3 ? "h-24" : "h-10"} w-full rounded-lg border border-glass/10 bg-glass/5`} />
              </div>
            ))}
            <Box className="h-10 w-full rounded-lg bg-glass/15" />
          </div>
        </div>
      </div>
      <div className="relative min-h-0 min-w-0 w-full lg:col-start-2 lg:row-start-1">
        <div className="glass-card relative z-[1] w-full min-w-0 rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <Box className="h-4 w-28 rounded bg-glass/10" />
            <Box className="h-7 w-24 rounded-lg border border-glass/15 bg-glass/10" />
          </div>
          <Box className="mt-4 h-4 w-3/4 rounded bg-glass/10" />
          <div className="mt-5 space-y-2.5">
            {[100, 92, 96, 70, 0, 88, 94, 60, 0, 40].map((w, i) =>
              w === 0 ? (
                <span key={i} className="block h-2" />
              ) : (
                <span key={i} className="block h-3 rounded bg-glass/10" style={{ width: `${w}%` }} aria-hidden />
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Fleet: title with its Beta badge, the toolbar, then the day grid (a two-week strip of columns). */
function FleetSkeleton() {
  return (
    <div className="glass-card space-y-3 rounded-2xl p-4 md:p-5">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold">
            <Bar>Fleet</Bar>
          </h2>
          <span className={`${BETA_BADGE_CLASS} bg-glass/10! text-transparent!`}>Beta</span>
        </div>
        <div className="flex items-center gap-2">
          <Box className="h-8 w-20 rounded-lg border border-glass/15 bg-glass/10" />
          <Box className="h-8 w-24 rounded-lg bg-glass/15" />
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {["w-24", "w-20", "w-28", "w-20"].map((w, i) => (
          <Box key={i} className={`h-8 ${w} rounded-lg border border-glass/15 bg-glass/10`} />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 pt-1 lg:grid-cols-14">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Box className="h-3 w-full rounded bg-glass/10" />
            <Box className="h-24 w-full rounded-lg border border-glass/10 bg-glass/5" />
          </div>
        ))}
      </div>
      <div className="space-y-2 pt-2">
        {[0, 1, 2].map((i) => (
          <Box key={i} className="h-11 w-full rounded-lg border border-glass/10 bg-glass/5" />
        ))}
      </div>
    </div>
  );
}

/** Admin and Settings: a side rail of sections on the left, the chosen section's body on the right. */
function RailSkeleton({ title }: { title: string }) {
  return (
    <Panel className="p-0">
      <div className="flex min-h-[min(70vh,560px)] flex-col md:flex-row">
        <div className="shrink-0 border-b border-glass/10 bg-overlay/40 md:w-[min(100%,240px)] md:border-b-0 md:border-r md:border-glass/10">
          <div className="border-b border-glass/10 px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-5">
            <h1 className="text-base font-semibold uppercase tracking-[0.15em] md:text-lg">
              <Bar>{title}</Bar>
            </h1>
          </div>
          <div className="space-y-1.5 px-2 py-3 md:py-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Box key={i} className={`h-9 w-full rounded-lg ${i === 0 ? "bg-glass/12" : "bg-glass/5"}`} />
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
          <Box className="h-6 w-44 rounded-lg bg-glass/10" />
          <Box className="h-4 w-72 max-w-full rounded bg-glass/10" />
          <div className="mt-2 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Box key={i} className="h-14 w-full rounded-xl border border-glass/10 bg-glass/5" />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** The full-window Google frame (google-embed-panel.tsx): a thin header row, then the sheet or form filling the rest. */
function EmbedSkeleton({ title }: { title: string }) {
  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col gap-1.5 bg-surface p-1.5 pt-[max(0.375rem,var(--safe-top))] pb-[max(0.375rem,var(--safe-bottom))] motion-safe:animate-pulse"
      aria-hidden
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <Box className="h-7 w-28 rounded-lg border border-glass/15 bg-glass/10" />
          <h1 className="truncate text-xs font-semibold">
            <Bar>{title}</Bar>
          </h1>
        </div>
        <Box className="h-7 w-36 rounded-lg border border-glass/15 bg-glass/10" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-glass/10 bg-glass/5">
        <div className="grid h-full grid-cols-[3rem_repeat(8,minmax(0,1fr))] grid-rows-[2rem_repeat(18,minmax(0,1fr))] gap-px bg-glass/5">
          {Array.from({ length: 9 * 19 }, (_, i) => (
            <span key={i} className={i < 9 || i % 9 === 0 ? "bg-glass/8" : "bg-surface/80"} />
          ))}
        </div>
      </div>
    </div>
  );
}
