import type { CSSProperties } from "react";
import Image from "next/image";
import type { ModuleKey } from "@/lib/dashboard-modules";
import {
  MODULE_VIEW_LABELS,
  NAVBAR_EYEBROW_CLASS,
  NAVBAR_LOGO_CLASS,
  NAVBAR_LOGO_SRC,
  NAVBAR_TITLE,
  NAVBAR_TITLE_CLASS,
} from "@/components/workspace-home-layout";
import {
  MOBILE_HOME_EYEBROW_CLASS,
  MOBILE_HOME_GREETING_CLASS,
  MOBILE_HOME_INTRO_CLASS,
  MOBILE_HOME_NAVBAR_BRAND_CLASS,
  MOBILE_HOME_NAVBAR_CLASS,
  MOBILE_HOME_NAVBAR_ROW_CLASS,
  MOBILE_HOME_NAVBAR_SURFACE_CLASS,
  MOBILE_HOME_SCREEN_TOP_CLASS,
} from "./home-layout";
import { MOBILE_LOOK } from "./look";

/**
 * Route-level skeleton for the phone dashboard, returned by
 * app/dashboard/loading.tsx when the request comes from a phone.
 *
 * With no module it is the home: drawn to the same shape as MobileHome (top
 * bar, two tiles, the With-you card, four shortcuts) and the tab bar, so the
 * page lands where the placeholders were. Keep it in step with
 * mobile-home.tsx and mobile-tab-bar.tsx. This is the screen the launch
 * camera opens on, so it carries the camera's target.
 *
 * With a module (a reload under `?module=`) it is that module's screen: the
 * phone's top bar (back chevron, title, avatar) and a body in the shape of
 * the screen that is about to arrive (mobile/time, mail, fleet, settings,
 * admin), with the tab bar underneath. No splash plays over it, so this is
 * what the person sees until the data is in. The Google embeds are a
 * full-window frame of their own (google-embed-panel.tsx), with no tab bar.
 */
export function MobileSkeleton({ module = null }: { module?: ModuleKey | null }) {
  if (module) return <MobileModuleSkeleton module={module} />;
  return (
    <main className="relative min-h-dvh bg-surface text-ink" aria-busy="true" data-mobile-look={MOBILE_LOOK}>
      <div className={`m-screen motion-safe:animate-pulse ${MOBILE_HOME_SCREEN_TOP_CLASS}`}>
        <header>
          <div className={MOBILE_HOME_NAVBAR_CLASS}>
            <div className={MOBILE_HOME_NAVBAR_SURFACE_CLASS} data-launch-reveal="surface" style={{ "--reveal-i": 0 } as CSSProperties} aria-hidden />
            <div className={MOBILE_HOME_NAVBAR_ROW_CLASS}>
              <div className={MOBILE_HOME_NAVBAR_BRAND_CLASS}>
                <Image src={NAVBAR_LOGO_SRC} alt="" width={28} height={28} className={NAVBAR_LOGO_CLASS} priority data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties} />
                <div className="min-w-0">
                  <p className={NAVBAR_EYEBROW_CLASS} data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties}>
                    Flyability Internal
                  </p>
                  {/* The real title, so the launch camera has its target while the home streams in. */}
                  <p className={NAVBAR_TITLE_CLASS} data-launch-target>
                    {NAVBAR_TITLE}
                  </p>
                </div>
              </div>
              <span className="h-10 w-10 rounded-full bg-glass/10" data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties} />
            </div>
          </div>
          <div className={MOBILE_HOME_INTRO_CLASS} data-launch-reveal style={{ "--reveal-i": 1 } as CSSProperties}>
            <p className={MOBILE_HOME_EYEBROW_CLASS}>Workspace</p>
            {/* One greeting line at the real line height (28px × 1.15). */}
            <span className={`${MOBILE_HOME_GREETING_CLASS} block h-[2.0125rem] w-56 rounded bg-glass/10`} />
          </div>
        </header>
        <div className="grid grid-cols-2 gap-3 px-4 pt-2">
          {[0, 1].map((i) => (
            <span key={i} className="block min-h-[5.75rem] rounded-2xl border border-glass/10 bg-panel" data-launch-reveal style={{ "--reveal-i": 2 + i } as CSSProperties} />
          ))}
          <span className="col-span-2 block h-36 rounded-2xl border border-glass/10 bg-panel" data-launch-reveal style={{ "--reveal-i": 4 } as CSSProperties} />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block min-h-14 rounded-2xl border border-glass/10 bg-panel" data-launch-reveal style={{ "--reveal-i": 5 + i } as CSSProperties} />
          ))}
        </div>
      </div>
      <SkeletonTabBar launch />
      <span className="sr-only">Loading your workspace…</span>
    </main>
  );
}

/* ------------------------------------------------------------ module screens */

const EMBED_MODULES: ReadonlySet<ModuleKey> = new Set(["planning", "fleetsheet", "roaddays"]);

/** The phone's module titles (mobile-shell.tsx / the screens' own top bars). */
const PHONE_TITLES: Record<ModuleKey, string> = {
  ...MODULE_VIEW_LABELS,
  fleet: "Fleet",
};

/** A block placeholder; the shape is the caller's. */
function Box({ className }: { className: string }) {
  return <span className={`block ${className}`} aria-hidden />;
}

function MobileModuleSkeleton({ module }: { module: ModuleKey }) {
  if (EMBED_MODULES.has(module)) return <MobileEmbedSkeleton title={PHONE_TITLES[module]} />;
  return (
    <main className="relative min-h-dvh bg-surface text-ink" aria-busy="true" data-mobile-look={MOBILE_LOOK}>
      <div className="m-screen motion-safe:animate-pulse">
        {/* The top bar as MobileTopBar draws it: chevron slot, title, avatar. */}
        <header className="m-topbar sticky top-0 z-30 flex items-center gap-2 bg-surface px-3 pb-2 pt-[max(0.5rem,var(--safe-top))]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" aria-hidden>
            <span className="block h-5 w-5 rounded bg-glass/10" />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{PHONE_TITLES[module]}</h1>
          {module === "settings" || module === "admin" ? null : <span className="block h-10 w-10 shrink-0 rounded-full bg-glass/10" aria-hidden />}
        </header>
        {module === "time" ? (
          <PhoneTimeBody />
        ) : module === "mail" ? (
          <PhoneMailBody />
        ) : module === "fleet" ? (
          <PhoneFleetBody />
        ) : (
          <PhoneGroupsBody />
        )}
      </div>
      <SkeletonTabBar />
      <span className="sr-only">Loading {PHONE_TITLES[module]}…</span>
    </main>
  );
}

/** Time: the two tiles (this week, overtime), the week stepper, then the seven day rows. */
function PhoneTimeBody() {
  return (
    <div className="space-y-4 px-4 pt-1">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <Box key={i} className="min-h-[5.75rem] rounded-2xl border border-glass/10 bg-panel" />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Box className="h-11 w-11 rounded-xl" />
        <div className="flex min-h-11 min-w-0 flex-1 items-center justify-center">
          <Box className="h-4 w-36 rounded bg-glass/10" />
        </div>
        <Box className="h-11 w-11 rounded-xl" />
        <Box className="ml-1 h-6 w-14 shrink-0 rounded-full border border-glass/15" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Box key={i} className="min-h-14 rounded-2xl border border-glass/10 bg-panel" />
        ))}
      </div>
    </div>
  );
}

/** Mail: labelled fields, the brief textarea, the assets disclosure, the generate button. */
function PhoneMailBody() {
  return (
    <div className="space-y-5 px-4 pt-1">
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-1.5">
            <Box className="h-3 w-24 rounded bg-glass/10" />
            <Box className="h-12 w-full rounded-xl border border-glass/10 bg-panel" />
          </div>
        ))}
        <div className="space-y-1.5">
          <Box className="h-3 w-16 rounded bg-glass/10" />
          <Box className="min-h-32 w-full rounded-xl border border-glass/10 bg-panel" />
        </div>
        <Box className="h-12 w-full rounded-xl border border-glass/10 bg-panel" />
      </div>
      <Box className="h-12 w-full rounded-xl bg-glass/15" />
    </div>
  );
}

/** Fleet: the window heading with its refresh, then the booking rows. */
function PhoneFleetBody() {
  return (
    <div className="space-y-4 px-4 pt-1">
      <div className="flex items-center justify-between gap-2">
        <Box className="h-4 w-32 rounded bg-glass/10" />
        <Box className="h-9 w-16 rounded-lg bg-glass/10" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Box key={i} className="min-h-16 rounded-2xl border border-glass/10 bg-panel" />
        ))}
      </div>
      <Box className="h-12 w-full rounded-xl bg-glass/15" />
    </div>
  );
}

/** Settings and Admin: grouped lists of rows, as MobileGroup draws them. */
function PhoneGroupsBody() {
  return (
    <div className="space-y-5 px-4 pt-2">
      {[3, 4, 2].map((rows, g) => (
        <div key={g} className="space-y-2">
          <Box className="ml-1 h-3 w-24 rounded bg-glass/10" />
          <div className="overflow-hidden rounded-2xl border border-glass/10 bg-panel">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={`flex min-h-12 items-center justify-between gap-3 px-4 ${i > 0 ? "border-t border-glass/10" : ""}`}>
                <Box className="h-4 w-32 rounded bg-glass/10" />
                <Box className="h-3 w-10 rounded bg-glass/10" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The full-window Google frame (google-embed-panel.tsx), phone-sized: header row, then the sheet or form. */
function MobileEmbedSkeleton({ title }: { title: string }) {
  return (
    <main className="relative min-h-dvh bg-surface text-ink" aria-busy="true" data-mobile-look={MOBILE_LOOK}>
      <div
        className="fixed inset-0 z-[110] flex flex-col gap-1.5 bg-surface p-1.5 pt-[max(0.375rem,var(--safe-top))] pb-[max(0.375rem,var(--safe-bottom))] motion-safe:animate-pulse"
        aria-hidden
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-3">
            <Box className="h-7 w-20 rounded-lg border border-glass/15 bg-glass/10" />
            <h1 className="truncate text-xs font-semibold text-ink">{title}</h1>
          </div>
          <Box className="h-7 w-24 rounded-lg border border-glass/15 bg-glass/10" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-glass/10 bg-glass/5">
          <div className="grid h-full grid-cols-[2.25rem_repeat(4,minmax(0,1fr))] grid-rows-[2rem_repeat(22,minmax(0,1fr))] gap-px bg-glass/5">
            {Array.from({ length: 5 * 23 }, (_, i) => (
              <span key={i} className={i < 5 || i % 5 === 0 ? "bg-glass/8" : "bg-surface/80"} />
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading {title}…</span>
    </main>
  );
}

/**
 * The tab bar's shape (mobile-tab-bar.tsx). On the home it is launch-late
 * chrome (hidden until the camera has settled); on a module screen no
 * camera runs, so it is simply there.
 */
function SkeletonTabBar({ launch = false }: { launch?: boolean }) {
  return (
    <nav
      className="m-tabbar fixed inset-x-0 bottom-0 z-[95] flex items-stretch border-t border-glass/10 bg-surface pb-safe"
      aria-hidden
      {...(launch ? { "data-launch-late": "" } : {})}
    >
      {["Time", "Mail", "Fleet"].map((label) => (
        <span key={label} className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] text-transparent">
          <span className="h-6 w-6 rounded-md bg-glass/10" />
          {label}
        </span>
      ))}
      <span className="flex shrink-0 items-center py-1.5 pl-1 pr-3">
        <span className="block h-11 w-24 rounded-full bg-glass/10" />
      </span>
    </nav>
  );
}
