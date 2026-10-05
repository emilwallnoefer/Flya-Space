"use client";

import { AnimatePresence, m } from "framer-motion";
import dynamic from "next/dynamic";
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthNavbar } from "@/components/auth-navbar";
import { OfflineGameCard } from "@/components/offline-game-card";
import { ChatBubbleIcon } from "@/components/chat/icons";
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
} from "@/components/workspace-home-layout";
import { MailComposerPanel } from "@/components/mail-composer/mail-composer-panel";
import { useMailComposer } from "@/components/mail-composer/use-mail-composer";
import { TimeTrackerPanel, type WeekResponse } from "@/components/time-tracker-panel";
import type { InitialSettingsData } from "@/lib/settings-queries";
import type { AdminListedUser, AdminTimeOverview } from "@/lib/admin-queries";
import { playUiSound } from "@/lib/ui-sounds";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { writeViewParams } from "@/lib/view-params";
import { LATEST_RELEASE } from "@/lib/release-notes";
import { userRoleLabel, type UserRole } from "@/lib/user-role";

function PanelLoading() {
  return <div className="min-h-[40vh] animate-pulse rounded-2xl border border-glass/10 bg-glass/5" aria-hidden />;
}

// Settings and Admin sit behind a click for every user, so their code (and the
// admin insights charts behind AdminPanel) stays out of the dashboard's first
// bundle. Mail/Time stay static: one of them is the landing module per role.
const SettingsPanel = dynamic(
  () => import("@/components/settings-panel").then((m) => m.SettingsPanel),
  { ssr: false, loading: PanelLoading },
);
const AdminPanel = dynamic(
  () => import("@/components/admin-panel").then((m) => m.AdminPanel),
  { ssr: false, loading: PanelLoading },
);
// Team chat opens from the floating pill and is mounted only while it is open.
// It is what pulls supabase-js (realtime included) into the browser, and while
// mounted it holds a postgres_changes subscription — a standing cost on the
// database for every open dashboard tab, which the 0.5 GB instance cannot
// spare (it swaps, and the first queries after a quiet spell stall for
// seconds). So the pill itself is plain markup in the shell: nothing
// chat-related loads or connects until someone clicks it, which is also why it
// shows no unread count.
const ChatWidget = dynamic(() => import("@/components/chat-widget").then((m) => m.ChatWidget), {
  ssr: false,
});
// Fleet is beta and behind a click for everyone, so it stays out of the first bundle.
const FleetPanel = dynamic(
  () => import("@/components/fleet/fleet-panel").then((m) => m.FleetPanel),
  { ssr: false, loading: PanelLoading },
);
// Field stats sit open at the bottom of the workspace home, below the fold. The
// chunk loads and the panel fetches (a sheet read) only once someone scrolls
// near it — see FieldStatsOnScroll.
const FieldStatsPanel = dynamic(
  () => import("@/components/field-stats/field-stats-panel").then((m) => m.FieldStatsPanel),
  { ssr: false, loading: PanelLoading },
);

// Fleet and Admin sit behind a click, so the server does not hold the first
// paint for their data: it streams in as a promise after the shell is already
// on screen. The panel suspends only if it is opened before the data arrives.
/**
 * Mounts Field stats once the bottom of the workspace home comes within a
 * screen of the viewport, so a visit that never scrolls loads no chart code and
 * reads no sheet.
 */
function FieldStatsOnScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return <div ref={ref}>{visible ? <FieldStatsPanel /> : <div className="h-64" aria-hidden />}</div>;
}

/**
 * A faint double chevron that points at Field stats below the fold: it fades
 * in once after the home loads and then holds still (nothing on screen may
 * animate forever), and is gone the moment the page is scrolled.
 */
function ScrollHint({ active }: { active: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    const onScroll = () => {
      if (window.scrollY > 24) setDone(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [done]);
  if (!active || done) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex justify-center text-ink-3">
      <m.div initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ duration: 0.6, delay: 0.8, ease: "easeOut" }}>
        <svg className="h-8 w-12" viewBox="0 0 48 32" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 5l18 10L42 5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 17l18 10L42 17" />
        </svg>
      </m.div>
    </div>
  );
}

function StreamedFleetPanel({ board }: { board: Promise<FleetBoardResponse | null> }) {
  return <FleetPanel initialBoard={use(board)} />;
}

function StreamedAdminPanel({
  canManageUsers,
  users,
  overview,
}: {
  canManageUsers: boolean;
  users: Promise<AdminListedUser[] | null>;
  overview: Promise<AdminTimeOverview | null>;
}) {
  return <AdminPanel canManageUsers={canManageUsers} initialUsers={use(users)} initialOverview={use(overview)} />;
}

const RESOLVED_NULL: Promise<null> = Promise.resolve(null);

type DashboardShellProps = {
  email: string;
  initialRole: UserRole | null;
  isAdmin?: boolean;
  initialWeek?: WeekResponse | null;
  /** SSR-prefetched Settings data (Gmail status + travel mapping + signature). */
  initialSettings?: InitialSettingsData | null;
  /** SSR-prefetched admin data, streamed (resolves to null for non-admins). */
  initialAdminUsers?: Promise<AdminListedUser[] | null>;
  initialAdminOverview?: Promise<AdminTimeOverview | null>;
  /** SSR-prefetched Fleet board, streamed so the calendar paints without a fetch. */
  initialFleet?: Promise<FleetBoardResponse | null>;
  /**
   * Module to open on load, parsed server-side from `?module=`. It is what makes
   * a reload (and the fleet reminder deep links) land on the view the user left,
   * and it is resolved on the server so the right panel is in the first paint
   * instead of flashing the workspace home. `null` = the workspace home.
   */
  initialModule?: ModuleKey | null;
};

import type { FleetBoardResponse } from "@/components/fleet/types";

// One-time flag: the first-launch README prompt is for brand-new users only,
// so it keys on "seen ever" rather than the deploy/version (which used to
// re-trigger it on every release).
const PROGRAM_README_PROMPT_SEEN_KEY = "ma_program_readme_prompt_seen_v1";
// Tracks the last release whose "What's new" popup the user dismissed.
const WHATS_NEW_SEEN_VERSION_KEY = "ma_whats_new_seen_version_v1";

function greetingFromEmail(addr: string): string {
  const local = addr.split("@")[0]?.trim() ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  if (!first) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function IconMail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}

function IconClock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconDrone({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.5 9.5h5v5h-5zM9.5 9.5 7 7m7.5 2.5L17 7m-2.5 7.5L17 17m-7.5-2.5L7 17"
      />
      <circle cx="5.5" cy="5.5" r="2.5" />
      <circle cx="18.5" cy="5.5" r="2.5" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function IconArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

/* Module cards use a nested "bezel" enclosure (outer tray + inner core with a
 * concentric radius), matching the chat widget's frame/screen construction. */
export function DashboardShell({
  email,
  initialRole,
  isAdmin = false,
  initialWeek = null,
  initialSettings = null,
  initialAdminUsers = RESOLVED_NULL,
  initialAdminOverview = RESOLVED_NULL,
  initialFleet = RESOLVED_NULL,
  initialModule = null,
}: DashboardShellProps) {
  // The role is decided entirely on the server: it lives in `app_metadata`,
  // only PATCH /api/admin/users writes it, and an account without one never
  // reaches this shell at all (dashboard/page.tsx renders the RoleGate
  // instead). So this is a prop, not state — there is nothing here that can
  // change it, which is also why `availableModules` below is fixed for the
  // lifetime of the shell.
  const userRole: UserRole | null = initialRole;

  const availableModules = useMemo<ModuleKey[]>(() => {
    const base: ModuleKey[] =
      userRole === "sales" || userRole === "hr"
        ? ["time", "fleet", "settings"]
        : ["mail", "time", "fleet", "settings"];
    if (isAdmin || userRole === "hr") base.push("admin");
    return base;
  }, [userRole, isAdmin]);

  // Cards on the workspace home: Time Tracker always, Mail and Fleet when
  // available. Settings and Admin live in the burger menu, not here.
  const homeCardCount = 1 + (["mail", "fleet"] as const).filter((key) => availableModules.includes(key)).length;

  const [showComposer, setShowComposer] = useState(initialModule != null);
  const [beginAnimating, setBeginAnimating] = useState(false);
  // `?module=` is attacker-supplied (and survives a role change in a bookmark),
  // so the requested module is clamped to what this role may actually open —
  // here, at the initial value, and again in `switchModule`. It used to be a
  // corrective effect that re-set the state after the first render; doing it
  // before there is a state to correct is both cheaper and one less render.
  const [activeModule, setActiveModule] = useState<ModuleKey>(() => {
    const preferred = initialModule ?? (userRole === "sales" || userRole === "hr" ? "time" : "mail");
    return availableModules.includes(preferred) ? preferred : availableModules[0];
  });
  const [showProgramReadmePrompt, setShowProgramReadmePrompt] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  // The floating chat pill shares the bottom-right corner with the first-launch
  // and "What's new" popups. Their height varies per release, so measure the
  // visible one and lift the pill just above it instead of guessing a fixed rem.
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsReadmeOpenToken, setSettingsReadmeOpenToken] = useState(0);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; gmail_email?: string | null }>(
    initialSettings?.gmail ?? { connected: false },
  );
  // Current Time Tracker week, warmed in the background on dashboard load so the
  // Time Logger opens instantly. Seeded from the SSR week when available.
  const [prefetchedWeek, setPrefetchedWeek] = useState<WeekResponse | null>(initialWeek);
  const weekPrefetchedRef = useRef(false);

  const composer = useMailComposer(userRole);

  const canManageUsers = isAdmin;
  const adminModuleLabel = canManageUsers ? "Admin" : "Team time";

  // Warm the Time Tracker's current week as soon as the dashboard loads, so the
  // Time Logger shows data immediately on open instead of fetching on mount.
  // Deliberately light: one idle-time request, no travel-sheet lookup, run once,
  // and skipped entirely when the SSR already seeded the current week.
  useEffect(() => {
    if (weekPrefetchedRef.current) return;
    if (!availableModules.includes("time")) return;

    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(
      monday.getDate(),
    ).padStart(2, "0")}`;

    // Already have this exact week from SSR — nothing to warm.
    if (initialWeek?.week_start === weekKey) {
      weekPrefetchedRef.current = true;
      return;
    }
    weekPrefetchedRef.current = true;

    let cancelled = false;
    let timeoutHandle: number | undefined;
    const run = () => {
      fetch(`/api/time-tracker?weekStart=${encodeURIComponent(weekKey)}&includeTravel=0`)
        .then((res) => (res.ok ? (res.json() as Promise<WeekResponse>) : null))
        .then((week) => {
          if (!cancelled && week?.week_start) setPrefetchedWeek(week);
        })
        .catch(() => {
          // Best-effort warm-up; the panel still fetches on open if this fails.
        });
    };

    const idle = (window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    }).requestIdleCallback;
    if (typeof idle === "function") {
      idle(run, { timeout: 2000 });
    } else {
      timeoutHandle = window.setTimeout(run, 800);
    }

    return () => {
      cancelled = true;
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [availableModules, initialWeek]);

  // Warm the Gmail connection status for the mail composer. Skipped when the SSR
  // already seeded it (pilots), so it is correct on first paint without a
  // client round-trip; still runs as a fallback when props were absent.
  const gmailStatusSeeded = initialSettings?.gmail != null;
  useEffect(() => {
    if (gmailStatusSeeded) return;
    (async () => {
      if (userRole === "sales" || userRole === "hr") return;
      const response = await fetch("/api/gmail/status");
      if (!response.ok) return;
      const data = (await response.json()) as { connected: boolean; gmail_email?: string | null };
      setGmailStatus(data);
    })();
  }, [userRole, gmailStatusSeeded]);

  // Which bottom-right popup to show, decided once from localStorage.
  //
  // `react-hooks/set-state-in-effect` is suppressed for this effect ONLY. The
  // decision depends on `window.localStorage`, which does not exist during SSR:
  // reading it in a lazy `useState` initializer would make the server and the
  // first client render disagree and produce a hydration mismatch on the popup.
  // A mount effect is the correct shape here; the compliant alternative is
  // `useSyncExternalStore`, which is a bigger change than this popup warrants.
  //
  // This is long-standing code, not new: the rule only started reporting it
  // once the first-login role picker was removed from this component and the
  // React Compiler could analyse the whole function again.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const firstLaunchSeen = window.localStorage.getItem(PROGRAM_README_PROMPT_SEEN_KEY);
      if (!firstLaunchSeen) {
        // Brand-new user: show the one-time first-launch README prompt, and mark
        // the current release as already seen so they only ever get the
        // "What's new" popup for *future* releases (everything is new to them now).
        setShowProgramReadmePrompt(true);
        try {
          window.localStorage.setItem(WHATS_NEW_SEEN_VERSION_KEY, LATEST_RELEASE.version);
        } catch {
          // Ignore storage errors.
        }
        return;
      }
      // Returning user: surface the "What's new" popup once per release.
      const seenVersion = window.localStorage.getItem(WHATS_NEW_SEEN_VERSION_KEY) || "";
      if (seenVersion !== LATEST_RELEASE.version) {
        setShowWhatsNew(true);
      }
    } catch {
      // Storage blocked (e.g. private mode): stay quiet rather than nagging.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Mirror the open module into `?module=`, so a reload (or a shared link, or
  // the fleet reminder mail's /dashboard?module=fleet) restores the same view
  // instead of dropping the user back on the workspace home. `replaceState`
  // keeps this out of the history stack: switching modules is not a navigation.
  //
  // `?section=` belongs to whichever panel is open (Admin, Settings), which owns
  // it via `useViewParam`; `switchModule` below clears it when the module
  // changes, so a section never leaks from one panel into another.
  useEffect(() => {
    writeViewParams({ module: showComposer ? activeModule : null });
  }, [activeModule, showComposer]);

  // Every module switch goes through here. The `?section=` reset happens now,
  // not in the sync effect above, because the incoming panel reads the URL while
  // it renders — which is before any effect of this commit runs. Clearing it
  // afterwards would wipe the section the new panel had just written.
  const switchModule = useCallback(
    (next: ModuleKey) => {
      // Same clamp as the initial value: a module this role cannot open falls
      // back to the first one it can, so `activeModule` is never unavailable.
      const target = availableModules.includes(next) ? next : availableModules[0];
      if (target !== activeModule) writeViewParams({ section: null });
      setActiveModule(target);
    },
    [activeModule, availableModules],
  );

  function dismissProgramReadmePrompt() {
    setShowProgramReadmePrompt(false);
    try {
      window.localStorage.setItem(PROGRAM_README_PROMPT_SEEN_KEY, "1");
    } catch {
      // Ignore storage errors to avoid blocking interaction.
    }
  }

  function dismissWhatsNew() {
    setShowWhatsNew(false);
    try {
      window.localStorage.setItem(WHATS_NEW_SEEN_VERSION_KEY, LATEST_RELEASE.version);
    } catch {
      // Ignore storage errors to avoid blocking interaction.
    }
  }

  function handleBeginAutomating() {
    if (beginAnimating) return;
    setBeginAnimating(true);
    setTimeout(() => {
      setShowComposer(true);
      setBeginAnimating(false);
    }, 180);
  }

  function openModuleCard(module: ModuleKey) {
    if (activeModule !== module) playUiSound("switchWhoosh");
    switchModule(module);
    handleBeginAutomating();
  }

  return (
    <main id="main-content" className="relative min-h-dvh overflow-x-hidden bg-surface text-ink">
      <div className="absolute inset-0 aurora-bg" />
      <section className="page-shell">
        <AuthNavbar
          activeModule={activeModule}
          availableModules={availableModules}
          adminModuleLabel={adminModuleLabel}
          onSelectModule={(module) => {
            if (!availableModules.includes(module)) return;
            if (module !== activeModule) playUiSound("switchWhoosh");
            switchModule(module);
            setShowComposer(true);
          }}
        />

        {showComposer ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-glass/[0.07] pb-4">
            <button
              type="button"
              onClick={() => {
                playUiSound("switchWhoosh");
                setShowComposer(false);
              }}
              className="group inline-flex items-center gap-2 rounded-xl border border-glass/10 bg-overlay/40 px-3.5 py-2 text-xs font-medium text-ink-3 shadow-sm shadow-shade/20 backdrop-blur-sm transition hover:border-accent/25 hover:bg-glass/[0.06] hover:text-ink"
            >
              <span className="transition group-hover:-translate-x-0.5" aria-hidden>
                ←
              </span>
              Workspace overview
            </button>
            <p className="text-[11px] text-ink-5">
              {activeModule === "mail"
                ? "Mail Composer"
                : activeModule === "time"
                  ? "Time Tracker"
                  : activeModule === "fleet"
                    ? "Fleet (beta)"
                    : activeModule === "admin"
                      ? adminModuleLabel
                      : "Settings"}
            </p>
          </div>
        ) : null}

        {!showComposer && (
          <m.div
            // Render the workspace home settled on first paint (no entrance fade/slide,
            // which read as the page "redrawing" on every load). `initial={false}` keeps
            // the click-to-open exit transition below working via `beginAnimating`.
            initial={false}
            animate={beginAnimating ? { opacity: 0 } : { opacity: 1 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className={HOME_HERO_CLASS}
          >
            <div className="dashboard-mesh" aria-hidden />
            <div className="dashboard-mesh-fade" aria-hidden />
            <div className={HOME_CONTENT_CLASS}>
              <div className={HOME_INTRO_CLASS}>
                <p className={HOME_EYEBROW_CLASS}>Workspace</p>
                <h1 className={HOME_GREETING_CLASS}>
                  {timeGreeting()}, {greetingFromEmail(email)}
                </h1>
                <p className={HOME_SUBTITLE_CLASS}>{HOME_SUBTITLE}</p>
                {userRole ? <span className={HOME_ROLE_PILL_CLASS}>{userRoleLabel(userRole)}</span> : null}
              </div>

              <div className={homeGridClass(homeCardCount)}>
                {availableModules.includes("mail") ? (
                  <m.button
                    type="button"
                    initial={false}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => openModuleCard("mail")}
                    className={`${MODULE_CARD_CLASS} hover:border-accent/35 hover:shadow-[0_28px_56px_-12px_rgba(34,211,238,0.12)] focus-visible:outline-accent/80`}
                  >
                    <span className={MODULE_CARD_CORE_CLASS}>
                      <span className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent/15 blur-2xl transition group-hover:bg-accent/25" aria-hidden />
                      <span className={`${MODULE_CARD_ICON_CLASS} border-accent/25 bg-accent/10 text-accent-soft`}>
                        <IconMail className="h-5 w-5" />
                      </span>
                      <span className={MODULE_CARD_TITLE_CLASS}>{HOME_CARDS[0].title}</span>
                      <span className={MODULE_CARD_DESCRIPTION_CLASS}>{HOME_CARDS[0].description}</span>
                      <span className={`${MODULE_CARD_CTA_CLASS} text-accent-soft/90`}>
                        Continue
                        <span className={MODULE_CARD_ARROW_CLASS}>
                          <IconArrow className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </span>
                  </m.button>
                ) : null}

                <m.button
                  type="button"
                  initial={false}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => openModuleCard("time")}
                  className={`${MODULE_CARD_CLASS} hover:border-emerald-400/35 hover:shadow-[0_28px_56px_-12px_rgba(52,211,153,0.1)] focus-visible:outline-emerald-400/80`}
                >
                  <span className={MODULE_CARD_CORE_CLASS}>
                    <span className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-400/12 blur-2xl transition group-hover:bg-emerald-400/22" aria-hidden />
                    <span className={`${MODULE_CARD_ICON_CLASS} border-emerald-400/25 bg-emerald-400/10 text-positive`}>
                      <IconClock className="h-5 w-5" />
                    </span>
                    <span className={MODULE_CARD_TITLE_CLASS}>{HOME_CARDS[1].title}</span>
                    <span className={MODULE_CARD_DESCRIPTION_CLASS}>{HOME_CARDS[1].description}</span>
                    <span className={`${MODULE_CARD_CTA_CLASS} text-positive/90`}>
                      Continue
                      <span className={MODULE_CARD_ARROW_CLASS}>
                        <IconArrow className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </span>
                </m.button>

                {availableModules.includes("fleet") ? (
                  <m.button
                    type="button"
                    initial={false}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => openModuleCard("fleet")}
                    className={`${MODULE_CARD_CLASS} hover:border-sky-400/35 hover:shadow-[0_28px_56px_-12px_rgba(56,189,248,0.1)] focus-visible:outline-sky-400/80`}
                  >
                    <span className={MODULE_CARD_CORE_CLASS}>
                      <span className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-sky-400/12 blur-2xl transition group-hover:bg-sky-400/22" aria-hidden />
                      <span className={`${MODULE_CARD_ICON_CLASS} border-sky-400/25 bg-sky-400/10 text-sky-200`}>
                        <IconDrone className="h-5 w-5" />
                      </span>
                      <span className={MODULE_CARD_TITLE_CLASS}>
                        {HOME_CARDS[2].title}
                        <span className={BETA_BADGE_CLASS}>Beta</span>
                      </span>
                      <span className={MODULE_CARD_DESCRIPTION_CLASS}>{HOME_CARDS[2].description}</span>
                      <span className={`${MODULE_CARD_CTA_CLASS} text-sky-200/90`}>
                        Continue
                        <span className={MODULE_CARD_ARROW_CLASS}>
                          <IconArrow className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </span>
                  </m.button>
                ) : null}
              </div>
            </div>
          </m.div>
        )}

        {!showComposer && !beginAnimating ? (
          <div className="relative z-[1] mx-auto w-full max-w-5xl pb-10">
            <FieldStatsOnScroll />
          </div>
        ) : null}
        <ScrollHint active={!showComposer && !beginAnimating} />

        <AnimatePresence initial={false}>
          {showComposer ? (
            <m.section
              key="composer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={activeModule}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  {activeModule === "time" ? (
                    <TimeTrackerPanel initialWeek={prefetchedWeek} />
                  ) : activeModule === "fleet" ? (
                    <Suspense fallback={<PanelLoading />}>
                      <StreamedFleetPanel board={initialFleet} />
                    </Suspense>
                  ) : activeModule === "admin" ? (
                    <Suspense fallback={<PanelLoading />}>
                      <StreamedAdminPanel
                        canManageUsers={canManageUsers}
                        users={initialAdminUsers}
                        overview={initialAdminOverview}
                      />
                    </Suspense>
                  ) : activeModule === "settings" ? (
                    // SSR-prefetched settings seed both the Gmail status above
                    // and the panel itself, so opening Settings fires none of its
                    // three mount fetches.
                    <SettingsPanel
                      email={email}
                      autoOpenProgramReadmeToken={settingsReadmeOpenToken}
                      userRole={userRole ?? "eu_pilot"}
                      initialData={initialSettings}
                    />
                  ) : (
                    <MailComposerPanel
                      composer={composer}
                      userRole={userRole}
                      gmailConnected={gmailStatus.connected}
                    />
                  )}
                </m.div>
              </AnimatePresence>
            </m.section>
          ) : null}
        </AnimatePresence>

      </section>
      {chatOpen ? <ChatWidget isAdmin={isAdmin} onClose={() => setChatOpen(false)} /> : null}
      <AnimatePresence>
        {/* Hidden while the panel is open, and while a bottom-right popup
            (program readme, what's new) holds that corner. */}
        {!chatOpen && !showProgramReadmePrompt && !showWhatsNew ? (
          <m.button
            key="chat-trigger"
            type="button"
            aria-label="Open team chat"
            initial={{ opacity: 0, scale: 0.85, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 12 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              playUiSound("switchWhoosh");
              setChatOpen(true);
            }}
            className={CHAT_PILL_CLASS}
          >
            <ChatBubbleIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Team chat</span>
          </m.button>
        ) : null}
      </AnimatePresence>
      <OfflineGameCard />
      {showProgramReadmePrompt ? (
        <div
          className="fixed bottom-4 right-4 z-[120] w-[min(92vw,22rem)] rounded-xl border border-glass/20 bg-surface/92 p-3 shadow-xl backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/75">First launch</p>
            </div>
            <button
              type="button"
              onClick={dismissProgramReadmePrompt}
              className="group rounded-md border border-glass/15 bg-glass/10 px-2 py-1 text-xs text-ink-2 transition hover:bg-glass/15"
              aria-label="Close program readme prompt"
            >
              <span className="inline-block transition-transform duration-200 group-hover:rotate-90" aria-hidden>
                ×
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              playUiSound("switchWhoosh");
              switchModule("settings");
              setShowComposer(true);
              setSettingsReadmeOpenToken((prev) => prev + 1);
              dismissProgramReadmePrompt();
            }}
            className="mt-3 w-full rounded-lg bg-accent/90 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:-translate-y-px hover:bg-accent"
          >
            Open program README
          </button>
        </div>
      ) : null}
      {showWhatsNew ? (
        <div
          className="fixed bottom-4 right-4 z-[120] w-[min(92vw,22rem)] rounded-xl border border-glass/20 bg-surface/92 p-3 shadow-xl backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/75">
                What&apos;s new · {LATEST_RELEASE.date}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{LATEST_RELEASE.title}</p>
            </div>
            <button
              type="button"
              onClick={dismissWhatsNew}
              className="group shrink-0 rounded-md border border-glass/15 bg-glass/10 px-2 py-1 text-xs text-ink-2 transition hover:bg-glass/15"
              aria-label="Dismiss what's new"
            >
              <span className="inline-block transition-transform duration-200 group-hover:rotate-90" aria-hidden>
                ×
              </span>
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-ink-3/85">
            {LATEST_RELEASE.highlights.map((highlight, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-accent/80" aria-hidden>
                  •
                </span>
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
