"use client";

import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { markLaunchReady, whenLaunchDone } from "@/lib/launch-ready";
import type { DashboardShellProps } from "@/components/dashboard-shell";
import { useMailComposer } from "@/components/mail-composer/use-mail-composer";
import { OfflineGameCard } from "@/components/offline-game-card";
import { PanelLoading } from "@/components/panel-loading";
import { todayCell } from "@/lib/google-embed-today-client";
import { withAuthUser, withRange, type EmbedSheet } from "@/lib/google-embeds";
import type { FleetBoardResponse } from "@/components/fleet/types";
import { HOME_CARDS } from "@/components/workspace-home-layout";
import { MODULE_KEYS, type ModuleKey } from "@/lib/dashboard-modules";
import { LATEST_RELEASE } from "@/lib/release-notes";
import { playUiSound } from "@/lib/ui-sounds";
import { pushViewParams, readViewParam, wasPushedByUs, writeViewParams } from "@/lib/view-params";
import { MOBILE_LOOK } from "./look";
import { MobileHome } from "./mobile-home";
import { NotificationsPrompt } from "./notifications-prompt";
import { MobileScreen, type NavDirection } from "./screen";
import { MobileTabBar, type MobileTab } from "./mobile-tab-bar";
import { MobileTimeScreen } from "./time/mobile-time-screen";
import { MobileFleetScreen } from "./fleet/mobile-fleet-screen";
import { MobileMailScreen } from "./mail/mobile-mail-screen";
import { MobileSettingsScreen } from "./settings/mobile-settings-screen";
import { MobileAdminScreen } from "./admin/mobile-admin-screen";
import { MobileTeamScreen } from "./team/mobile-team-screen";
import { useFieldStats } from "./team/use-field-stats";
import { MobileAvatar, MobileButton, MobileGroup, MobileRow, MobileSheet, MobileTopBar } from "./primitives";
import { useHomeSummary } from "./use-home-summary";
import { useChatUnreadCount } from "@/components/chat/hooks/use-chat-unread";

// Chat pulls supabase-js realtime into the browser; it loads only when opened.
const MobileChatScreen = dynamic(() => import("./chat/mobile-chat-screen").then((m) => m.MobileChatScreen), { ssr: false });
const GoogleEmbedPanel = dynamic(() => import("@/components/google-embed-panel").then((m) => m.GoogleEmbedPanel), { ssr: false, loading: PanelLoading });

// Same keys as the desktop shell, so a release seen on one device is seen on both.
const PROGRAM_README_PROMPT_SEEN_KEY = "ma_program_readme_prompt_seen_v1";
const WHATS_NEW_SEEN_VERSION_KEY = "ma_whats_new_seen_version_v1";

const RESOLVED_NULL: Promise<null> = Promise.resolve(null);

/** The fleet board streams in from the server; suspend until it lands. */
function StreamedMobileFleet({ board }: { board: Promise<FleetBoardResponse | null> }) {
  return <MobileFleetScreen initialBoard={use(board)} />;
}

export type MobileShellProps = DashboardShellProps;

/**
 * The phone's dashboard. Rendered by app/dashboard/page.tsx instead of
 * DashboardShell when lib/device.ts says the request comes from a phone;
 * takes exactly the same props, so the server does the same work for both.
 *
 * Native-app shaped: a home board of tiles, a tab bar (Time, Mail, Fleet and
 * Chat), and one module on screen at a time with a back chevron. Opening a module pushes a history entry, so the
 * Back gesture returns home. The module screens reuse the shared hooks; the
 * markup is the phone's own (the modules not yet rebuilt for the phone show
 * their desktop panel inside the phone chrome until their phase lands).
 *
 * The Google sheets and form are framed as on the desktop, but each tile also
 * carries a link out to Google: WebKit gives a third-party frame no Google
 * session, so on most iPhones the frame is a white screen and the link is the
 * way in (lib/google-embeds.ts).
 */
export function MobileShell({
  email,
  initialRole,
  isAdmin = false,
  initialWeek = null,
  initialSettings = null,
  initialAdminUsers = RESOLVED_NULL,
  initialAdminOverview = RESOLVED_NULL,
  initialFleet = RESOLVED_NULL,
  initialModule = null,
  missionPlanning = null,
  fleetSheet = null,
  roadDays = null,
}: MobileShellProps) {
  const userRole = initialRole;

  // Same role → modules mapping as the desktop shell.
  const availableModules = useMemo<ModuleKey[]>(() => {
    const base: ModuleKey[] = userRole === "sales" || userRole === "hr" ? ["time", "fleet", "settings"] : ["mail", "time", "fleet", "settings"];
    if (missionPlanning) base.push("planning");
    if (fleetSheet) base.push("fleetsheet");
    if (roadDays) base.push("roaddays");
    if (isAdmin || userRole === "hr") base.push("admin");
    return base;
  }, [userRole, isAdmin, missionPlanning, fleetSheet, roadDays]);

  const [activeModule, setActiveModule] = useState<ModuleKey | null>(() =>
    initialModule && availableModules.includes(initialModule) ? initialModule : null,
  );
  const [chatOpen, setChatOpen] = useState(false);
  // The Chat tab's red badge: counted without loading the chat (see the hook).
  const chatUnread = useChatUnreadCount(chatOpen);
  // Opened from a mention notification (`/dashboard?chat=open`): straight to
  // the chat. In an effect, not the initial state, because this shell is
  // server-rendered and the URL is only known in the browser.
  useEffect(() => {
    if (readViewParam("chat", ["open"] as const) !== "open") return;
    const frame = requestAnimationFrame(() => {
      setChatOpen(true);
      writeViewParams({ chat: null });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // "Log today" from Home opens the Time screen straight onto today's sheet.
  const [timeEditToday, setTimeEditToday] = useState(false);
  // "Team in the field": a screen of its own under More, not a module (no URL state).
  const [teamOpen, setTeamOpen] = useState(false);
  // Which way the next screen change moves: deeper (1) or back (-1).
  const [navDir, setNavDir] = useState<NavDirection>(1);
  const field = useFieldStats(true);
  const fieldTotals = useMemo(() => {
    const all = field.stats?.all;
    if (!all) return null;
    return {
      poc: all.pilots.reduce((n, p) => n + p.poc, 0),
      training: all.pilots.reduce((n, p) => n + p.training, 0),
      travel: all.pilots.reduce((n, p) => n + p.travelDays, 0),
    };
  }, [field.stats]);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; gmail_email?: string | null }>(
    initialSettings?.gmail ?? { connected: false },
  );
  const composer = useMailComposer(userRole);
  const adminModuleLabel = isAdmin ? "Admin" : "Team time";

  const summary = useHomeSummary({
    initialWeek,
    wantsTime: availableModules.includes("time"),
    wantsFleet: availableModules.includes("fleet"),
    refreshKey,
  });

  // Gmail status for the mail composer, when the server did not seed it.
  const gmailStatusSeeded = initialSettings?.gmail != null;
  // The real home is on screen: the launch camera may pull back now.
  useEffect(() => {
    markLaunchReady();
  }, []);
  useEffect(() => {
    if (gmailStatusSeeded || userRole === "sales" || userRole === "hr") return;
    fetch("/api/gmail/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { connected: boolean; gmail_email?: string | null } | null) => {
        if (data) setGmailStatus(data);
      })
      .catch(() => {});
  }, [userRole, gmailStatusSeeded]);
  useEffect(() => {
    function refresh() {
      fetch("/api/gmail/status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { connected: boolean; gmail_email?: string | null } | null) => {
          if (data) setGmailStatus(data);
        })
        .catch(() => {});
    }
    window.addEventListener("ma-gmail-status-changed", refresh);
    return () => window.removeEventListener("ma-gmail-status-changed", refresh);
  }, []);

  // "What's new" once per release. A brand-new user is marked as having seen
  // the current release (everything is new to them); the first-launch README
  // prompt is a desktop affair.
  // Not before the launch camera has finished (lib/launch-ready.ts).
  useEffect(() => {
    let cancelled = false;
    void whenLaunchDone().then(() => {
      if (cancelled) return;
      try {
        const firstLaunchSeen = window.localStorage.getItem(PROGRAM_README_PROMPT_SEEN_KEY);
        if (!firstLaunchSeen) {
          window.localStorage.setItem(PROGRAM_README_PROMPT_SEEN_KEY, "1");
          window.localStorage.setItem(WHATS_NEW_SEEN_VERSION_KEY, LATEST_RELEASE.version);
          return;
        }
        if (window.localStorage.getItem(WHATS_NEW_SEEN_VERSION_KEY) !== LATEST_RELEASE.version) setWhatsNewOpen(true);
      } catch {
        // Storage blocked: stay quiet.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismissWhatsNew() {
    setWhatsNewOpen(false);
    try {
      window.localStorage.setItem(WHATS_NEW_SEEN_VERSION_KEY, LATEST_RELEASE.version);
    } catch {
      // Ignore.
    }
  }

  // URL mirror + history: opening a module from home pushes, so Back returns
  // home; switching between modules replaces; popstate restores the view.
  useEffect(() => {
    writeViewParams({ module: activeModule });
  }, [activeModule]);
  useEffect(() => {
    function onPopState() {
      setNavDir(-1);
      const restored = readViewParam("module", MODULE_KEYS);
      setActiveModule(restored && availableModules.includes(restored) ? restored : null);
      setMoreOpen(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [availableModules]);

  const openModule = useCallback(
    (module: ModuleKey, options?: { editToday?: boolean }) => {
      if (!availableModules.includes(module)) return;
      setMoreOpen(false);
      setTimeEditToday(module === "time" && Boolean(options?.editToday));
      if (module === activeModule) return;
      setNavDir(1);
      playUiSound("switchWhoosh");
      if (activeModule === null) pushViewParams({ module, section: null });
      else writeViewParams({ section: null });
      setActiveModule(module);
    },
    [availableModules, activeModule],
  );

  const goHome = useCallback(() => {
    setMoreOpen(false);
    if (activeModule === null) return;
    setNavDir(-1);
    playUiSound("switchWhoosh");
    setRefreshKey((key) => key + 1);
    if (wasPushedByUs()) {
      window.history.back();
      return;
    }
    setActiveModule(null);
  }, [activeModule]);

  function onTab(tab: MobileTab) {
    if (tab === "chat") {
      setMoreOpen(false);
      setChatOpen(true);
      return;
    }
    openModule(tab);
  }

  const activeTab: MobileTab | null = activeModule === "mail" || activeModule === "time" || activeModule === "fleet" ? activeModule : null;
  const embedOpen = activeModule === "planning" || activeModule === "fleetsheet" || activeModule === "roaddays";
  const screenKey = teamOpen ? "team" : (activeModule ?? "home");
  function openTeam() {
    setNavDir(1);
    setMoreOpen(false);
    setTeamOpen(true);
  }
  function closeTeam() {
    setNavDir(-1);
    setTeamOpen(false);
  }
  // The two calendar sheets' links out open on today's cell when the server
  // can find it (the frame does its own lookup); the links work without it.
  const [todayCells, setTodayCells] = useState<Partial<Record<EmbedSheet, string | null>>>({});
  const wantsPlanningToday = missionPlanning?.today ?? null;
  const wantsFleetToday = fleetSheet?.today ?? null;
  useEffect(() => {
    let cancelled = false;
    for (const sheet of [wantsPlanningToday, wantsFleetToday]) {
      if (!sheet) continue;
      void todayCell(sheet).then((cell) => {
        if (!cancelled) setTodayCells((cells) => ({ ...cells, [sheet]: cell }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [wantsPlanningToday, wantsFleetToday]);
  const embeds = (
    [
      missionPlanning
        ? {
            key: "planning" as const,
            title: HOME_CARDS[3].title,
            href: withAuthUser(withRange(missionPlanning.open, missionPlanning.today && todayCells[missionPlanning.today]), email),
          }
        : null,
      fleetSheet
        ? {
            key: "fleetsheet" as const,
            title: HOME_CARDS[4].title,
            href: withAuthUser(withRange(fleetSheet.open, fleetSheet.today && todayCells[fleetSheet.today]), email),
          }
        : null,
      roadDays ? { key: "roaddays" as const, title: HOME_CARDS[5].title, href: withAuthUser(roadDays.open, email) } : null,
    ] as Array<{ key: ModuleKey; title: string; href: string } | null>
  ).filter((embed): embed is { key: ModuleKey; title: string; href: string } => embed !== null);
  // The framed view's "Still blank?" card links out to the same URL as the tile's ↗.
  const hintFor = (key: ModuleKey) => ({ openHref: embeds.find((embed) => embed.key === key)?.href ?? "" });

  return (
    <main id="main-content" className="relative min-h-dvh bg-surface text-ink" data-mobile-look={MOBILE_LOOK}>
      {MOBILE_LOOK === "skin" ? <div className="fixed inset-0 -z-10 aurora-bg" aria-hidden data-launch-late /> : null}
      <MobileScreen screenKey={screenKey} direction={navDir}>
      {teamOpen ? (
        <div className="m-screen">
          <MobileTeamScreen field={field} onBack={closeTeam} />
        </div>
      ) : activeModule === null ? (
        <MobileHome
          email={email}
          availableModules={availableModules}
          summary={summary}
          embeds={embeds}
          onOpenModule={openModule}
          onOpenMore={() => setMoreOpen(true)}
        />
      ) : activeModule === "planning" && missionPlanning ? (
        <GoogleEmbedPanel title={HOME_CARDS[3].title} urls={missionPlanning} onBack={goHome} phoneHint={hintFor("planning")} />
      ) : activeModule === "fleetsheet" && fleetSheet ? (
        <GoogleEmbedPanel title={HOME_CARDS[4].title} urls={fleetSheet} onBack={goHome} phoneHint={hintFor("fleetsheet")} />
      ) : activeModule === "roaddays" && roadDays ? (
        <GoogleEmbedPanel title={HOME_CARDS[5].title} urls={roadDays} onBack={goHome} phoneHint={hintFor("roaddays")} />
      ) : activeModule === "admin" ? (
        <div className="m-screen">
          <Suspense fallback={<PanelLoading />}>
            <MobileAdminScreen canManageUsers={isAdmin} initialUsers={initialAdminUsers} initialOverview={initialAdminOverview} onBack={goHome} />
          </Suspense>
        </div>
      ) : activeModule === "settings" ? (
        <div className="m-screen">
          <MobileSettingsScreen userRole={userRole} initialData={initialSettings} onBack={goHome} />
        </div>
      ) : (
        <div className="m-screen">
          <MobileTopBar
            title={
              activeModule === "mail"
                ? "Mail Composer"
                : activeModule === "time"
                  ? "Time Tracker"
                  : "Fleet"
            }
            onBack={goHome}
            right={<MobileAvatar email={email} onClick={() => setMoreOpen(true)} />}
          />
          <div>
            {activeModule === "time" ? (
              <MobileTimeScreen initialWeek={summary.week} editToday={timeEditToday} />
            ) : activeModule === "fleet" ? (
              <Suspense fallback={<PanelLoading />}>
                <StreamedMobileFleet board={initialFleet} />
              </Suspense>
            ) : (
              <MobileMailScreen composer={composer} userRole={userRole} gmailConnected={gmailStatus.connected} />
            )}
          </div>
        </div>
      )}
      </MobileScreen>

      <MobileTabBar active={activeTab} availableModules={availableModules} onSelect={onTab} hidden={embedOpen || chatOpen} chatUnread={chatUnread} />

      <AnimatePresence>{chatOpen ? <MobileChatScreen key="chat" isAdmin={isAdmin} onClose={() => setChatOpen(false)} /> : null}</AnimatePresence>

      <MobileSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <MobileGroup>
          <MobileRow label="Settings" detail="Appearance, Gmail, data" chevron onClick={() => openModule("settings")} />
          {availableModules.includes("admin") ? (
            <MobileRow label={adminModuleLabel} detail={isAdmin ? "Team time and users · the rest on desktop" : "Everyone's hours"} chevron onClick={() => openModule("admin")} />
          ) : null}
          <MobileRow
            label="Team in the field"
            detail={fieldTotals ? `${fieldTotals.poc} POCs · ${fieldTotals.training} trainings · ${fieldTotals.travel} travel days this year` : "Regions, POCs and trainings this year"}
            chevron
            onClick={openTeam}
          />
          <MobileRow label="What's new" detail={LATEST_RELEASE.title} chevron onClick={() => { setMoreOpen(false); setWhatsNewOpen(true); }} />
        </MobileGroup>
        <p className="mt-4 px-1 text-xs text-ink-5">Signed in as {email}</p>
        <form action="/logout" method="post" className="mt-2">
          <MobileButton type="submit" variant="secondary">
            Sign out
          </MobileButton>
        </form>
      </MobileSheet>

      <MobileSheet open={whatsNewOpen} onClose={dismissWhatsNew} title={`What's new · ${LATEST_RELEASE.date}`} footer={<MobileButton onClick={dismissWhatsNew}>Got it</MobileButton>}>
        <p className="text-base font-semibold text-ink">{LATEST_RELEASE.title}</p>
        <ul className="mt-2 space-y-2 text-sm text-ink-3">
          {LATEST_RELEASE.highlights.map((highlight, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-accent/80" aria-hidden>
                •
              </span>
              <span>{highlight}</span>
            </li>
          ))}
        </ul>
      </MobileSheet>

      <NotificationsPrompt held={whatsNewOpen} />

      <OfflineGameCard />
    </main>
  );
}
