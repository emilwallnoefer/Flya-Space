/**
 * Route-level skeleton for the phone dashboard, returned by
 * app/dashboard/loading.tsx when the request comes from a phone. It must sit
 * where MobileShell's home will: the same contract the desktop skeleton has
 * with workspace-home-layout.ts, kept here for the mobile tree.
 */
export function MobileSkeleton() {
  return (
    <main className="flex min-h-dvh flex-col bg-surface px-4 pb-safe pt-safe text-ink" aria-busy="true" data-mobile-look="native">
      <section className="my-auto rounded-2xl border border-glass/10 bg-panel p-5 motion-safe:animate-pulse">
        <span className="block h-3 w-20 rounded bg-glass/10" />
        <span className="mt-3 block h-6 w-3/4 rounded bg-glass/10" />
        <span className="mt-3 block h-4 w-full rounded bg-glass/10" />
        <span className="mt-5 block h-11 w-full rounded-xl bg-glass/10" />
      </section>
      <span className="sr-only">Loading your workspace…</span>
    </main>
  );
}
