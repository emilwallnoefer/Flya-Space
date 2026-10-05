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
  NAVBAR_CLASS,
  NAVBAR_EYEBROW_CLASS,
  NAVBAR_LOGO_CLASS,
  NAVBAR_MENU_BUTTON_CLASS,
  NAVBAR_TITLE_CLASS,
} from "@/components/workspace-home-layout";

/**
 * Route-level skeleton for the dashboard: the workspace home, drawn from the
 * same layout classes and copy as the real page (`workspace-home-layout.ts`),
 * so every block sits exactly where it will land. Text is the real text made
 * transparent over a placeholder bar, which keeps line heights and wrapping
 * identical. The greeting and role are not known yet, so they use stand-ins
 * of typical length. It assumes the four-card home that pilots and admins see
 * (Mail, Time, Fleet, Mission planning).
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

export default function DashboardLoading() {
  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-surface text-ink" aria-busy="true">
      <div className="absolute inset-0 aurora-bg" />
      <section className="page-shell">
        {/* Navbar and hero are direct children of the page shell, like on the
            real page, so the shell's flex gap spaces them the same way. */}
        <div className={`${NAVBAR_CLASS} motion-safe:animate-pulse`}>
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <div className={NAVBAR_LOGO_CLASS}>FA</div>
              <div className="min-w-0">
                <p className={NAVBAR_EYEBROW_CLASS}>Flyability Internal</p>
                <p className={NAVBAR_TITLE_CLASS}>Flya Allrounder</p>
              </div>
            </div>
            <span className={`${NAVBAR_MENU_BUTTON_CLASS} text-transparent`}>
              <span className="hidden sm:inline">Menu</span>
              <span className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className={`${HOME_HERO_CLASS} motion-safe:animate-pulse`}>
          <div className="dashboard-mesh" aria-hidden />
          <div className="dashboard-mesh-fade" aria-hidden />
          <div className={HOME_CONTENT_CLASS}>
            <div className={HOME_INTRO_CLASS}>
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
              {HOME_CARDS.map((card) => (
                <div key={card.key} className={MODULE_CARD_CLASS}>
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
        <span className={`${CHAT_PILL_CLASS} pointer-events-none border-glass/15! bg-glass/10! text-transparent! shadow-none!`} aria-hidden>
          <span className="h-5 w-5" />
          <span className="hidden sm:inline">Team chat</span>
        </span>
        <span className="sr-only">Loading your workspace…</span>
      </section>
    </main>
  );
}
