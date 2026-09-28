"use client";

import { AnimatePresence, m } from "framer-motion";
import dynamic from "next/dynamic";
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthNavbar } from "@/components/auth-navbar";
import { OfflineGameCard } from "@/components/offline-game-card";
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
// Team chat is a floating pill, never the first thing anyone needs, and it is
// what pulls supabase-js (realtime included) into the browser — the largest
// single library the dashboard ships. Loading it after hydration keeps all of
// that off the first paint; the pill simply appears a moment later.
const ChatWidget = dynamic(() => import("@/components/chat-widget").then((m) => m.ChatWidget), {
  ssr: false,
});
// Fleet is beta and behind a click for everyone, so it stays out of the first bundle.
const FleetPanel = dynamic(
  () => import("@/components/fleet/fleet-panel").then((m) => m.FleetPanel),
  { ssr: false, loading: PanelLoading },
);

// Fleet and Admin sit behind a click, so the server does not hold the first
// paint for their data: it streams in as a promise after the shell is already
// on screen. The panel suspends only if it is opened before the data arrives.
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

function IconCog({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.37.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
const MODULE_CARD_CLASS =
  "group relative flex flex-col overflow-hidden rounded-[1.4rem] border border-glass/[0.09] bg-glass/[0.04] p-1.5 text-left shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55)] transition duration-150 ease-fluid hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

const MODULE_CARD_CORE_CLASS =
  "relative flex flex-1 flex-col overflow-hidden rounded-[calc(1.4rem-0.375rem)] bg-gradient-to-br from-panel/95 via-surface/90 to-surface/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

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
  const bottomPopupRef = useRef<HTMLDivElement | null>(null);
  const [bottomPopupHeight, setBottomPopupHeight] = useState(0);
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

  // Warm the Gmail connection status for the navbar pill. Skipped when the SSR
  // already seeded it (pilots), so the pill is correct on first paint without a
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

  const bottomPopupVisible = showProgramReadmePrompt || showWhatsNew;

  useEffect(() => {
    // No reset when the popup hides: `chatBottomOffsetRem` already ignores the
    // measurement while `bottomPopupVisible` is false, so zeroing it here only
    // bought an extra render (and was a synchronous setState in an effect).
    if (!bottomPopupVisible) return;
    const el = bottomPopupRef.current;
    if (!el) return;
    const update = () => setBottomPopupHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bottomPopupVisible, showProgramReadmePrompt, showWhatsNew]);

  // Popups sit at bottom-4 (16px); park the chat pill 12px above the measured
  // top edge. Until the first measurement lands, fall back to the old fixed
  // offsets so the pill never starts on top of the popup.
  const chatBottomOffsetRem = !bottomPopupVisible
    ? 1
    : bottomPopupHeight > 0
      ? (16 + bottomPopupHeight + 12) / 16
      : showProgramReadmePrompt
        ? 11
        : 12;

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
          email={email}
          gmailConnected={gmailStatus.connected}
          gmailEmail={gmailStatus.gmail_email}
          activeModule={activeModule}
          availableModules={availableModules}
          showGmailStatus={userRole !== "sales" && userRole !== "hr"}
          userRole={userRole}
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
            className="relative flex min-h-[min(72vh,640px)] flex-col justify-center"
          >
            <div className="dashboard-mesh" aria-hidden />
            <div className="dashboard-mesh-fade" aria-hidden />
            <div className="relative z-[1] mx-auto w-full max-w-5xl">
              <div className="mb-10 md:mb-14">
                <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-accent-soft/65">Workspace</p>
                <h1 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-ink md:text-4xl lg:text-[2.65rem] lg:leading-[1.12]">
                  {timeGreeting()}, {greetingFromEmail(email)}
                </h1>
                <p className="mt-4 max-w-lg text-pretty text-sm leading-relaxed text-ink-4 md:text-base">
                  Open a module below and pick up right where you left off.
                </p>
                {userRole ? (
                  <span className="mt-5 inline-flex items-center rounded-full border border-glass/10 bg-glass/[0.06] px-3 py-1 text-[11px] font-medium tracking-wide text-ink-3">
                    {userRoleLabel(userRole)}
                  </span>
                ) : null}
              </div>

              <div
                className={`grid gap-4 ${availableModules.filter((m) => m !== "admin").length >= 3 ? "md:grid-cols-3" : "sm:mx-auto sm:max-w-2xl sm:grid-cols-2"}`}
              >
                {availableModules.includes("settings") ? (
                  <m.button
                    type="button"
                    initial={false}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => openModuleCard("settings")}
                    className={`${MODULE_CARD_CLASS} hover:border-violet-400/35 hover:shadow-[0_28px_56px_-12px_rgba(167,139,250,0.12)] focus-visible:outline-violet-400/80`}
                  >
                    <span className={MODULE_CARD_CORE_CLASS}>
                      <span className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-violet-400/12 blur-2xl transition group-hover:bg-violet-400/22" aria-hidden />
                      <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10 text-violet-200">
                        <IconCog className="h-5 w-5" />
                      </span>
                      <span className="text-lg font-semibold text-ink">Settings</span>
                      <span className="mt-2 text-sm leading-relaxed text-ink-4">
                        Gmail, signatures, travel mapping, sounds, and account tools.
                      </span>
                      <span className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-violet-200/90">
                        Continue
                        <span className="grid h-6 w-6 place-items-center rounded-full border border-glass/15 bg-glass/10 transition ease-fluid group-hover:-translate-y-[1px] group-hover:translate-x-1">
                          <IconArrow className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </span>
                  </m.button>
                ) : null}

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
                      <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent-soft">
                        <IconMail className="h-5 w-5" />
                      </span>
                      <span className="text-lg font-semibold text-ink">Mail Composer</span>
                      <span className="mt-2 text-sm leading-relaxed text-ink-4">
                        Training email drafts and Gmail handoff in one flow.
                      </span>
                      <span className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-accent-soft/90">
                        Continue
                        <span className="grid h-6 w-6 place-items-center rounded-full border border-glass/15 bg-glass/10 transition ease-fluid group-hover:-translate-y-[1px] group-hover:translate-x-1">
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
                    <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-positive">
                      <IconClock className="h-5 w-5" />
                    </span>
                    <span className="text-lg font-semibold text-ink">Time Tracker</span>
                    <span className="mt-2 text-sm leading-relaxed text-ink-4">
                      Workdays, breaks, compensation time, and overtime in one place.
                    </span>
                    <span className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-positive/90">
                      Continue
                      <span className="grid h-6 w-6 place-items-center rounded-full border border-glass/15 bg-glass/10 transition ease-fluid group-hover:-translate-y-[1px] group-hover:translate-x-1">
                        <IconArrow className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </span>
                </m.button>

              </div>
            </div>
          </m.div>
        )}

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
                    // SSR-prefetched settings seed both the navbar Gmail pill above
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
      <ChatWidget bottomOffsetRem={chatBottomOffsetRem} isAdmin={isAdmin} />
      <OfflineGameCard />
      {showProgramReadmePrompt ? (
        <div
          ref={bottomPopupRef}
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
          ref={bottomPopupRef}
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
