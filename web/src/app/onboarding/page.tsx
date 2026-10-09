import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { OnboardingWorkspace } from "@/components/onboarding-workspace";
import { buildOnboardingSections } from "@/lib/onboarding";
import { isPhoneRequest } from "@/lib/device";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const sections = buildOnboardingSections();

  // Phones: the same checklist under the mobile shell's kind of top bar
  // (components/mobile/), without the aurora and the glass header.
  if (isPhoneRequest(await headers())) {
    return (
      <main id="main-content" className="relative min-h-dvh bg-surface text-ink" data-mobile-look="native">
        <header className="sticky top-0 z-30 flex items-center gap-2 bg-surface/95 px-3 pb-2 pt-[max(0.5rem,var(--safe-top))] backdrop-blur-md">
          <a href="/dashboard" aria-label="Back to workspace" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-accent-soft">
            <span aria-hidden className="text-xl">&larr;</span>
          </a>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">Onboarding</h1>
        </header>
        <section className="px-4 pb-[max(1.5rem,var(--safe-bottom))]">
          <OnboardingWorkspace email={user.email ?? "pilot"} sections={sections} />
        </section>
      </main>
    );
  }

  return (
    <main id="main-content" className="relative min-h-dvh overflow-x-hidden bg-surface text-ink">
      <div className="absolute inset-0 aurora-bg" />
      <section className="page-shell relative z-[1]">
        <div className="glass-card sticky top-3 z-[90] !overflow-visible p-2.5 md:p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/70">Pilot Resources</p>
              <h1 className="text-sm font-semibold md:text-base">Onboarding</h1>
            </div>
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg border border-glass/15 bg-glass/8 px-3 py-1.5 text-xs transition hover:bg-glass/12"
            >
              Back to workspace
            </a>
          </div>
        </div>
        <OnboardingWorkspace email={user.email ?? "pilot"} sections={sections} />
      </section>
    </main>
  );
}
