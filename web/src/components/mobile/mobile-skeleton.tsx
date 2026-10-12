import type { CSSProperties } from "react";
import { NAVBAR_TITLE, NAVBAR_TITLE_CLASS } from "@/components/workspace-home-layout";
import {
  MOBILE_HOME_BRAND_CLASS,
  MOBILE_HOME_BRAND_ROW_CLASS,
  MOBILE_HOME_GREETING_CLASS,
  MOBILE_HOME_HEADER_CLASS,
  MOBILE_HOME_NAME_CLASS,
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
      <div className="m-screen motion-safe:animate-pulse">
        <header className={MOBILE_HOME_HEADER_CLASS}>
          <div className={MOBILE_HOME_BRAND_ROW_CLASS}>
            <span className={MOBILE_HOME_BRAND_CLASS}>
              {/* The real title, so the launch camera has its target while the home streams in. */}
              <span className={NAVBAR_TITLE_CLASS} data-launch-target>
                {NAVBAR_TITLE}
              </span>
            </span>
            <span className="h-10 w-10 rounded-full bg-glass/10" data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties} />
          </div>
          {/* The greeting and name boxes, at the real lines' heights (15px/20px and 34px × 1.1). */}
          <span className={`${MOBILE_HOME_GREETING_CLASS} h-5 w-28 rounded bg-glass/10`} data-launch-reveal style={{ "--reveal-i": 0 } as CSSProperties} />
          <span className={`${MOBILE_HOME_NAME_CLASS} h-[2.3375rem] w-40 rounded bg-glass/10`} data-launch-reveal style={{ "--reveal-i": 1 } as CSSProperties} />
        </header>
        <div className="grid grid-cols-2 gap-3 px-4 pt-1">
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
