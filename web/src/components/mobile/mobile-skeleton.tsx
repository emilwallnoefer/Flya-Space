import { MOBILE_LOOK } from "./look";

/**
 * Route-level skeleton for the phone dashboard, returned by
 * app/dashboard/loading.tsx when the request comes from a phone. Drawn to the
 * same shape as MobileHome (top bar, a row of tiles, With you, Google) and the tab bar,
 * so the page lands where the placeholders were. Keep it in step with
 * mobile-home.tsx and mobile-tab-bar.tsx.
 */
export function MobileSkeleton() {
  return (
    <main className="relative min-h-dvh bg-surface text-ink" aria-busy="true" data-mobile-look={MOBILE_LOOK}>
      <div className="m-screen motion-safe:animate-pulse">
        <header className="flex items-center gap-2 px-3 pb-2 pt-[max(0.5rem,var(--safe-top))]">
          <span className="w-1" />
          <span className="min-w-0 flex-1">
            <span className="mt-1 block h-4 w-28 rounded bg-glass/10" />
            <span className="mt-1.5 mb-1 block h-9 w-40 rounded bg-glass/10" />
          </span>
          <span className="h-10 w-10 rounded-full bg-glass/10" />
        </header>
        <div className="space-y-6 px-4 pt-2">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block min-h-[5.75rem] rounded-2xl border border-glass/10 bg-panel" />
            ))}
          </div>
          <div>
            <span className="mb-2 ml-1 block h-4 w-16 rounded bg-glass/10" />
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <span key={i} className="block min-h-[5.75rem] rounded-2xl border border-glass/10 bg-panel" />
              ))}
            </div>
          </div>
          <div>
            <span className="mb-2 ml-1 block h-4 w-14 rounded bg-glass/10" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="block min-h-[4.75rem] rounded-2xl border border-glass/10 bg-panel" />
              ))}
            </div>
          </div>
        </div>
      </div>
      <nav className="m-tabbar fixed inset-x-0 bottom-0 z-[95] flex items-stretch border-t border-glass/10 bg-surface pb-safe" aria-hidden>
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
