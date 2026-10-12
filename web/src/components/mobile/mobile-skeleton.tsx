import type { CSSProperties } from "react";
import Image from "next/image";
import {
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
 * app/dashboard/loading.tsx when the request comes from a phone. Drawn to the
 * same shape as MobileHome (top bar, two tiles, the With-you card, four shortcuts) and the tab bar,
 * so the page lands where the placeholders were. Keep it in step with
 * mobile-home.tsx and mobile-tab-bar.tsx.
 */
export function MobileSkeleton() {
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
      <nav className="m-tabbar fixed inset-x-0 bottom-0 z-[95] flex items-stretch border-t border-glass/10 bg-surface pb-safe" aria-hidden data-launch-late>
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
      <span className="sr-only">Loading your workspace…</span>
    </main>
  );
}
