"use client";

import type { DashboardShellProps } from "@/components/dashboard-shell";

/**
 * The phone's dashboard. Rendered by app/dashboard/page.tsx instead of
 * DashboardShell when lib/device.ts says the request comes from a phone;
 * takes exactly the same props, so the server does the same work for both.
 *
 * Phase 0 of the mobile masterplan: the shell is a placeholder that proves
 * the server branch, the skeleton and the guards. Phase 1 fills it in.
 */
export type MobileShellProps = DashboardShellProps;

export function MobileShell({ email }: MobileShellProps) {
  return (
    <main id="main-content" className="flex min-h-dvh flex-col bg-surface px-4 pb-safe pt-safe text-ink" data-mobile-look="native">
      <section className="my-auto rounded-2xl border border-glass/10 bg-panel p-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-accent-soft/80">Flya Space</p>
        <h1 className="mt-2 text-xl font-semibold">The phone layout is on its way</h1>
        <p className="mt-2 text-sm text-ink-3">
          Signed in as {email}. The dedicated mobile UI arrives module by module; until then, open flya.space on a computer.
        </p>
        <form action="/logout" method="post" className="mt-5">
          <button type="submit" className="min-h-11 w-full rounded-xl border border-glass/15 bg-glass/8 text-sm">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
