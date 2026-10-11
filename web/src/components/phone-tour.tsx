"use client";

import { AnimatePresence, m } from "framer-motion";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatBubbleIcon } from "@/components/chat/icons";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { greetingFromEmail, timeGreeting } from "@/lib/greeting";
import { PHONE_TOUR_SEEN_KEY, phoneTourSteps, type PhoneScreen, type PhoneSpot, type PhoneTourStep } from "@/lib/phone-tour-steps";
import { lockPageScroll } from "@/lib/scroll-lock";
import { playUiSound } from "@/lib/ui-sounds";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { cn } from "@/lib/cn";

/**
 * A centred, one-time walkthrough of the phone app, shown on the desktop the
 * first time someone signs in after it shipped: a mock iPhone whose screen
 * changes per step (home board, the tabs, logging a day, installing from
 * Safari), a spotlight ring with an arrow on the part that matters, and a
 * caption beside it. Step through with Next/Back or the arrow keys.
 *
 * The phone on screen is a drawing, not the real mobile shell: the desktop
 * tree must not import `components/mobile/**` (see lib/desktop-tree.test.ts),
 * and a mock needs no data. It shows the signed-in person's own first name,
 * the way the real home board does.
 *
 * Storage: `PHONE_TOUR_SEEN_KEY` once dismissed; `?tour=phone` re-opens it.
 */
export function PhoneTour({
  email,
  availableModules,
  onClose,
}: {
  email: string;
  availableModules: ModuleKey[];
  onClose: () => void;
}) {
  const steps = useMemo(() => phoneTourSteps(availableModules), [availableModules]);
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  useEffect(() => lockPageScroll(), []);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(PHONE_TOUR_SEEN_KEY, "1");
    } catch {
      // Storage blocked: the tour simply shows again next time.
    }
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (last) {
      finish();
      return;
    }
    playUiSound("switchWhoosh");
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [finish, last, steps.length]);
  const back = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight" || event.key === "Enter") next();
      else if (event.key === "ArrowLeft") back();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, finish, next]);

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center overflow-y-auto bg-overlay/70 p-4 backdrop-blur-sm" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-tour-title"
        tabIndex={-1}
        className="flex w-[min(96vw,52rem)] flex-col items-center gap-6 rounded-2xl border border-glass/20 bg-surface/95 p-5 shadow-2xl outline-none backdrop-blur-xl sm:flex-row sm:items-stretch sm:gap-8 sm:p-8"
      >
        <PhoneMock email={email} step={step} availableModules={availableModules} />

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/75">
            Flya Space on your phone · {index + 1} of {steps.length}
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={step.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <h2 id="phone-tour-title" className="mt-2 text-xl font-semibold text-ink">
                {step.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-3/90">{step.body}</p>
            </m.div>
          </AnimatePresence>

          <ol className="mt-5 flex flex-wrap gap-1.5" aria-label="Steps">
            {steps.map((item, itemIndex) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-label={`Step ${itemIndex + 1}: ${item.title}`}
                  aria-current={itemIndex === index ? "step" : undefined}
                  onClick={() => setIndex(itemIndex)}
                  className={cn(
                    "block h-1.5 rounded-full transition-all",
                    itemIndex === index ? "w-5 bg-accent" : itemIndex < index ? "w-1.5 bg-accent/50" : "w-1.5 bg-glass/25",
                  )}
                />
              </li>
            ))}
          </ol>

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={back}
              disabled={index === 0}
              className="rounded-lg border border-glass/15 bg-glass/10 px-3 py-2 text-xs font-medium text-ink-2 transition hover:bg-glass/15 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-accent/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:-translate-y-px hover:bg-accent"
            >
              {last ? "Done" : "Next"}
            </button>
            {!last ? (
              <button type="button" onClick={finish} className="ml-auto px-2 py-2 text-xs text-ink-4 transition hover:text-ink-2">
                Skip
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ phone */

const SCREEN_W = 268;
const SCREEN_H = 580;

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The iPhone drawing: a dark frame with a dynamic island, the status bar,
 * the mock screen for the step, and, measured from the element carrying
 * `data-spot`, a spotlight ring that dims everything else plus an arrow with
 * a short hint. The ring springs from one spot to the next between steps.
 */
function PhoneMock({ email, step, availableModules }: { email: string; step: PhoneTourStep; availableModules: ModuleKey[] }) {
  const screenRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  // Measure the spot's box inside the screen. Runs on every step change
  // (same screen: the ring springs to the new spot) and again when a new
  // screen has finished entering (`mode="wait"` mounts it only after the old
  // one has left, so at step-change time there is nothing to measure yet).
  const measure = useCallback(() => {
    const screen = screenRef.current;
    const target = screen && step.spot ? screen.querySelector<HTMLElement>(`[data-spot="${step.spot}"]`) : null;
    if (!screen || !target) {
      setRect(null);
      return;
    }
    const base = screen.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const pad = 4;
    setRect({ x: box.left - base.left - pad, y: box.top - base.top - pad, w: box.width + pad * 2, h: box.height + pad * 2 });
  }, [step.spot]);
  // A layout measurement has to happen after commit, so the rule against
  // setState in an effect is suppressed for this one effect only.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The arrow sits above the spot pointing down; a spot near the top gets it
  // beside (pointing left) when there is room, else below pointing up. The
  // hint rides with it.
  const placement: "above" | "below" | "side" = !rect ? "above" : rect.y > 96 ? "above" : rect.x + rect.w < SCREEN_W - 100 ? "side" : "below";

  return (
    <div className="shrink-0 select-none" aria-hidden>
      <div
        className="relative rounded-[3rem] border-[3px] border-slate-700/80 bg-slate-950 p-[9px] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.7)]"
        style={{ width: SCREEN_W + 24, height: SCREEN_H + 24 }}
      >
        <div className="absolute -left-[5px] top-24 h-7 w-[3px] rounded-l bg-slate-700/80" />
        <div className="absolute -left-[5px] top-36 h-12 w-[3px] rounded-l bg-slate-700/80" />
        <div className="absolute -left-[5px] top-52 h-12 w-[3px] rounded-l bg-slate-700/80" />
        <div className="absolute -right-[5px] top-40 h-16 w-[3px] rounded-r bg-slate-700/80" />
        <div
          ref={screenRef}
          className="relative overflow-hidden rounded-[2.4rem] bg-surface text-ink"
          style={{ width: SCREEN_W, height: SCREEN_H }}
        >
          <StatusBar light={step.screen === "home-screen"} />
          <div className="absolute left-1/2 top-2.5 z-40 h-[22px] w-[76px] -translate-x-1/2 rounded-full bg-black" />

          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={step.screen}
              className="absolute inset-0 pt-11"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.18 }}
              onAnimationComplete={(definition) => {
                if (definition === "exit") return;
                measure();
              }}
            >
              <Screen name={step.screen} email={email} activeTab={step.activeTab} availableModules={availableModules} />
            </m.div>
          </AnimatePresence>

          <AnimatePresence>
            {rect ? (
              <m.div
                key="spot"
                className="pointer-events-none absolute z-50 rounded-xl border-2 border-accent"
                style={{ boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5), 0 0 24px 0 rgb(34 211 238 / 0.45)" }}
                initial={{ opacity: 0, left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                animate={{ opacity: 1, left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
              />
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {rect ? (
              <m.div
                key={`arrow-${step.key}`}
                className="pointer-events-none absolute z-50"
                style={{ left: 0, top: 0 }}
                initial={{ opacity: 0, ...arrowOrigin(rect, placement, 8) }}
                animate={{ opacity: 1, ...arrowOrigin(rect, placement, 0) }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
              >
                <div
                  className={cn(
                    "flex items-center",
                    placement === "above" && "-translate-x-1/2 flex-col",
                    placement === "below" && "-translate-x-1/2 flex-col-reverse",
                    placement === "side" && "-translate-y-1/2 flex-row-reverse",
                  )}
                >
                  <span className="whitespace-nowrap rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-slate-900 shadow-lg">{step.hint}</span>
                  <svg
                    viewBox="0 0 24 28"
                    className={cn("h-7 w-6 text-accent drop-shadow", placement === "below" && "rotate-180", placement === "side" && "rotate-90")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v22M5 17l7 7 7-7" />
                  </svg>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** Where the arrow group anchors for a spot: its centre above, below, or at the right edge. */
function arrowOrigin(rect: Rect, placement: "above" | "below" | "side", offset: number): { x: number; y: number } {
  if (placement === "side") return { x: rect.x + rect.w + 6 + offset, y: rect.y + rect.h / 2 };
  if (placement === "below") return { x: rect.x + rect.w / 2, y: rect.y + rect.h + 6 + offset };
  return { x: rect.x + rect.w / 2, y: rect.y - 62 - offset };
}

function StatusBar({ light }: { light: boolean }) {
  return (
    <div className={cn("absolute inset-x-0 top-0 z-30 flex h-11 items-end justify-between px-6 pb-2 text-[12px] font-semibold", light ? "text-white" : "text-ink")}>
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <svg viewBox="0 0 18 12" className="h-3 w-4" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="0.5" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="0.5" />
          <rect x="10" y="3" width="3" height="9" rx="0.5" />
          <rect x="15" y="0" width="3" height="12" rx="0.5" />
        </svg>
        <svg viewBox="0 0 26 12" className="h-3 w-6" fill="none" stroke="currentColor">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" strokeOpacity="0.5" />
          <rect x="2" y="2" width="18" height="8" rx="1.5" fill="currentColor" stroke="none" />
          <path d="M23 4v4" strokeOpacity="0.5" />
        </svg>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ screens */

function Screen({
  name,
  email,
  activeTab,
  availableModules,
}: {
  name: PhoneScreen;
  email: string;
  activeTab: PhoneTourStep["activeTab"];
  availableModules: ModuleKey[];
}) {
  const first = greetingFromEmail(email);
  switch (name) {
    case "home":
      return <HomeBoard first={first} availableModules={availableModules} activeTab={activeTab} />;
    case "time":
      return <TimeScreen availableModules={availableModules} activeTab={activeTab} />;
    case "mail":
      return <MailScreen availableModules={availableModules} activeTab={activeTab} />;
    case "fleet":
      return <FleetScreen first={first} availableModules={availableModules} activeTab={activeTab} />;
    case "chat":
      return <ChatScreen first={first} availableModules={availableModules} activeTab={activeTab} />;
    case "day-empty":
      return <DaySheet filled={false} />;
    case "day-filled":
      return <DaySheet filled />;
    case "safari":
      return <SafariScreen first={first} />;
    case "share-sheet":
      return <ShareSheet />;
    case "home-screen":
      return <HomeScreen />;
  }
}

function Spot({ id, className, children }: { id: PhoneSpot; className?: string; children: ReactNode }) {
  return (
    <div data-spot={id} className={className}>
      {children}
    </div>
  );
}

function TopBar({ title, back, right }: { title: ReactNode; back?: boolean; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-3 pb-2 pt-1">
      {back ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center text-accent-soft">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </span>
      ) : (
        <span className="w-1" />
      )}
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</div>
      {right}
    </div>
  );
}

function Avatar({ first }: { first: string }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-from to-accent-to text-[12px] font-semibold text-slate-950">
      {first.slice(0, 1)}
    </span>
  );
}

function TabBar({ activeTab, availableModules }: { activeTab: PhoneTourStep["activeTab"]; availableModules: ModuleKey[] }) {
  const items: Array<{ key: NonNullable<PhoneTourStep["activeTab"]>; spot: PhoneSpot; icon: ReactNode }> = [
    { key: "time", spot: "tab-time", icon: <IconClock className="h-5 w-5" /> },
    ...(availableModules.includes("mail") ? [{ key: "mail" as const, spot: "tab-mail" as const, icon: <IconMail className="h-5 w-5" /> }] : []),
    ...(availableModules.includes("fleet") ? [{ key: "fleet" as const, spot: "tab-fleet" as const, icon: <IconDrone className="h-5 w-5" /> }] : []),
    { key: "chat", spot: "tab-chat", icon: <ChatBubbleIcon className="h-5 w-5" /> },
  ];
  return (
    <Spot id="tabbar" className="absolute inset-x-0 bottom-0 flex items-stretch border-t border-glass/10 bg-surface pb-5">
      {items.map((item) => (
        <Spot key={item.key} id={item.spot} className={cn("grid h-12 flex-1 place-items-center", item.key === activeTab ? "text-accent-soft" : "text-ink-4")}>
          {item.icon}
        </Spot>
      ))}
    </Spot>
  );
}

function Tile({ label, value, sub, tone = "default", spot }: { label: string; value: string; sub?: string; tone?: "default" | "accent" | "warn"; spot?: PhoneSpot }) {
  const body = (
    <div className="rounded-2xl border border-glass/10 bg-panel px-3 py-2.5">
      <p className="text-[10px] font-medium text-ink-4">{label}</p>
      <p className={cn("mt-0.5 text-[20px] font-bold leading-tight tabular-nums", tone === "accent" ? "text-accent-soft" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
      {sub ? <p className="text-[10px] text-ink-4">{sub}</p> : null}
    </div>
  );
  return spot ? <Spot id={spot}>{body}</Spot> : body;
}

function Row({ icon, label, value, accent, last }: { icon?: ReactNode; label: string; value?: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={cn("flex min-h-10 items-center gap-2.5 px-3 text-[12px]", !last && "border-b border-glass/10")}>
      {icon ? <span className={cn("shrink-0", accent ? "text-accent-soft" : "text-ink-4")}>{icon}</span> : null}
      <span className={cn("min-w-0 flex-1 truncate", accent ? "font-medium text-accent-soft" : "text-ink")}>{label}</span>
      {value ? <span className="shrink-0 text-ink-4">{value}</span> : null}
      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-ink-5" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}

function HomeBoard({ first, availableModules, activeTab }: { first: string; availableModules: ModuleKey[]; activeTab: PhoneTourStep["activeTab"] }) {
  const hasMail = availableModules.includes("mail");
  return (
    <div className="h-full">
      <div className="flex items-start justify-between px-4 pb-2 pt-1">
        <Spot id="greeting">
          <p className="text-[12px] font-medium text-ink-3">{timeGreeting()}</p>
          <p className="text-[24px] font-bold leading-[1.1] tracking-tight text-ink">{first}</p>
        </Spot>
        <Avatar first={first} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 px-3 pt-1">
        <Tile label="Overtime" value="+6:30" sub="Through Thu" tone="accent" />
        <Tile label="Today" value="--:--" sub="Not logged yet" />
        <div className="col-span-2 rounded-2xl border border-glass/10 bg-panel">
          <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium text-ink-4">With you</p>
          <Row icon={<IconDrone className="h-3.5 w-3.5" />} label="Elios 3" value="Back Fri 17" />
          <Row icon={<span className="text-[14px] leading-none">+</span>} label="Book material" accent last />
        </div>
        {hasMail ? <ShortTile icon={<IconMail className="h-4 w-4" />} label="New mail" /> : null}
        <ShortTile icon={<SheetGlyph />} label="Planning" link />
        <ShortTile icon={<SheetGlyph />} label="Fleet sheet" link wide={!hasMail} />
      </div>
      <TabBar activeTab={activeTab} availableModules={availableModules} />
    </div>
  );
}

function ShortTile({ icon, label, link, wide }: { icon: ReactNode; label: string; link?: boolean; wide?: boolean }) {
  return (
    <div className={cn("flex h-11 overflow-hidden rounded-2xl border border-glass/10 bg-panel", wide && "col-span-2")}>
      <div className="flex min-w-0 flex-[2] items-center gap-2 px-3">
        <span className="shrink-0 text-accent-soft">{icon}</span>
        <span className="truncate text-[12px] font-medium text-ink">{label}</span>
      </div>
      {link ? <div className="grid flex-1 place-items-center border-l border-glass/10 text-[11px] text-ink-4">↗</div> : null}
    </div>
  );
}

function SheetGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 9h16M4 15h16M10 9v12" />
    </svg>
  );
}

const WEEK: Array<{ day: string; date: string; value: string; tone?: "accent" | "muted" | "warn"; today?: boolean }> = [
  { day: "Mon", date: "6 Oct", value: "8:24", tone: "accent" },
  { day: "Tue", date: "7 Oct", value: "7:54" },
  { day: "Wed", date: "8 Oct", value: "8:06", tone: "accent" },
  { day: "Thu", date: "9 Oct", value: "7:54" },
  { day: "Fri", date: "10 Oct", value: "--:--", tone: "warn", today: true },
  { day: "Sat", date: "11 Oct", value: "", tone: "muted" },
  { day: "Sun", date: "12 Oct", value: "", tone: "muted" },
];

function TimeScreen({ availableModules, activeTab }: { availableModules: ModuleKey[]; activeTab: PhoneTourStep["activeTab"] }) {
  return (
    <div className="h-full">
      <TopBar title="Time" back />
      <div className="space-y-3 px-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="This week" value="32:18" sub="of 39:30" />
          <Tile label="Overtime bank" value="+6:30" tone="accent" />
        </div>
        <div className="flex items-center justify-between px-1 text-ink-3">
          <span className="text-[12px]">‹</span>
          <span className="text-center">
            <span className="block text-[12px] font-semibold text-ink">6 Oct – 12 Oct</span>
            <span className="block text-[9px] text-ink-4">This week · tap to pick</span>
          </span>
          <span className="text-[12px]">›</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-glass/10 bg-panel">
          {WEEK.map((row, index) => {
            const inner = (
              <div className={cn("flex min-h-10 items-center gap-2 px-3 text-[12px]", index < WEEK.length - 1 && "border-b border-glass/10", row.tone === "muted" && "opacity-50")}>
                <span className={cn("w-8 font-semibold", row.today ? "text-accent-soft" : "text-ink")}>{row.day}</span>
                <span className="flex-1 text-ink-4">{row.date}</span>
                <span className={cn("tabular-nums", row.tone === "accent" ? "text-accent-soft" : row.tone === "warn" ? "text-warn" : "text-ink-2")}>{row.value}</span>
                <svg viewBox="0 0 24 24" className="h-3 w-3 text-ink-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            );
            return row.today ? (
              <Spot key={row.day} id="today-row">
                {inner}
              </Spot>
            ) : (
              <div key={row.day}>{inner}</div>
            );
          })}
        </div>
      </div>
      <TabBar activeTab={activeTab} availableModules={availableModules} />
    </div>
  );
}

function DaySheet({ filled }: { filled: boolean }) {
  const box = "rounded-xl border border-glass/15 bg-glass/8 px-3 py-2.5 text-[15px] tabular-nums";
  return (
    <div className="h-full">
      <div className="absolute inset-x-0 top-11 h-full bg-black/40" />
      <div className="absolute inset-x-0 bottom-0 top-16 flex flex-col rounded-t-[1.6rem] border-t border-glass/15 bg-surface">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-glass/25" />
        <div className="flex items-center justify-between px-4 pb-3 pt-2">
          <span className="text-[15px] font-semibold text-ink">Friday, 10 Oct</span>
          <span className="text-[12px] text-ink-4">Close</span>
        </div>
        <div className="flex-1 space-y-4 px-4">
          <Spot id="start-stop" className="grid grid-cols-2 gap-2.5">
            <div>
              <p className="mb-1 text-[10px] text-ink-4">Start</p>
              <div className={cn(box, filled ? "text-ink" : "text-ink-5")}>{filled ? "09:00" : "--:--"}</div>
            </div>
            <div>
              <p className="mb-1 text-[10px] text-ink-4">Stop</p>
              <div className={cn(box, filled ? "text-ink" : "text-ink-5")}>{filled ? "17:54" : "--:--"}</div>
            </div>
          </Spot>
          {!filled ? <p className="-mt-2 text-[10px] text-ink-4">Tap a field to pick the time.</p> : null}
          <div>
            <p className="mb-1 text-[10px] text-ink-4">Fill the day</p>
            <Spot id="quick-fill" className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-glass/15 bg-glass/8 px-2 py-2 text-center text-[11px] font-medium text-ink-2">Compensate day</div>
              <div className={cn("rounded-xl border px-2 py-2 text-center text-[11px] font-medium", filled ? "border-accent/40 bg-accent/15 text-ink" : "border-glass/15 bg-glass/8 text-ink-2")}>Standard day</div>
            </Spot>
          </div>
          <div>
            <p className="mb-1 text-[10px] text-ink-4">Day type</p>
            <div className="grid grid-cols-2 gap-2">
              {["Normal", "Vacation", "Public holiday", "Sick"].map((label, index) => (
                <div key={label} className={cn("rounded-xl border px-2 py-2 text-center text-[11px] font-medium", index === 0 ? "border-accent/40 bg-accent/15 text-ink" : "border-glass/15 bg-glass/8 text-ink-2")}>
                  {label}
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] text-ink-4">Break</p>
            <div className="flex items-center justify-between rounded-xl border border-glass/15 bg-glass/8 px-3 py-2 text-[12px] text-ink">
              <span className="text-ink-3">−</span>
              <span className="tabular-nums">{filled ? "30 min" : "0 min"}</span>
              <span className="text-ink-3">+</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 border-t border-glass/10 px-4 pb-6 pt-3">
          <div className="rounded-xl border border-glass/15 bg-glass/8 px-4 py-2.5 text-[12px] font-medium text-ink-2">Reset</div>
          <Spot id="save" className="flex-1">
            <div className="rounded-xl bg-accent px-4 py-2.5 text-center text-[12px] font-semibold text-slate-900">Save · {filled ? "8:24" : "0:00"}</div>
          </Spot>
        </div>
      </div>
    </div>
  );
}

function MailScreen({ availableModules, activeTab }: { availableModules: ModuleKey[]; activeTab: PhoneTourStep["activeTab"] }) {
  return (
    <div className="h-full">
      <TopBar title="New mail" back />
      <div className="space-y-3 px-3">
        <div className="flex rounded-xl bg-glass/8 p-0.5 text-[11px] font-medium">
          <span className="flex-1 rounded-lg bg-panel py-1.5 text-center text-ink">Training</span>
          <span className="flex-1 py-1.5 text-center text-ink-4">Brief</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-glass/10 bg-panel">
          <Row label="Type" value="Post-training" />
          <Row label="Industry" value="Oil & gas" />
          <Row label="Customer" value="Aker BP" />
          <Row label="Recipients" value="2" last />
        </div>
        <div className="rounded-2xl border border-glass/10 bg-panel px-3 py-2.5">
          <p className="text-[10px] text-ink-4">Preview</p>
          <p className="mt-1 text-[11px] leading-snug text-ink-2">Hi Kari, thank you for the two days in Stavanger. Here are the links we talked about …</p>
        </div>
        <div className="rounded-xl bg-accent px-4 py-2.5 text-center text-[12px] font-semibold text-slate-900">Create Gmail draft</div>
      </div>
      <TabBar activeTab={activeTab} availableModules={availableModules} />
    </div>
  );
}

function FleetScreen({ first, availableModules, activeTab }: { first: string; availableModules: ModuleKey[]; activeTab: PhoneTourStep["activeTab"] }) {
  return (
    <div className="h-full">
      <TopBar title="Fleet" back />
      <div className="space-y-3 px-3">
        <div className="flex rounded-xl bg-glass/8 p-0.5 text-[11px] font-medium">
          <span className="flex-1 rounded-lg bg-panel py-1.5 text-center text-ink">Board</span>
          <span className="flex-1 py-1.5 text-center text-ink-4">Bookings</span>
          <span className="flex-1 py-1.5 text-center text-ink-4">History</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-glass/10 bg-panel">
          <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium text-ink-4">With you</p>
          <Row icon={<IconDrone className="h-3.5 w-3.5" />} label="Elios 3" value={`${first} · to Fri`} last />
        </div>
        <div className="overflow-hidden rounded-2xl border border-glass/10 bg-panel">
          <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium text-ink-4">Free now</p>
          <Row icon={<IconDrone className="h-3.5 w-3.5" />} label="Elios 3 (ultrasonic)" value="Free" />
          <Row icon={<IconDrone className="h-3.5 w-3.5" />} label="Asio X" value="Free" />
          <Row icon={<IconDrone className="h-3.5 w-3.5" />} label="Elios 2" value="Mon 20" last />
        </div>
        <div className="rounded-xl bg-accent px-4 py-2.5 text-center text-[12px] font-semibold text-slate-900">Book material</div>
      </div>
      <TabBar activeTab={activeTab} availableModules={availableModules} />
    </div>
  );
}

function ChatScreen({ first, availableModules, activeTab }: { first: string; availableModules: ModuleKey[]; activeTab: PhoneTourStep["activeTab"] }) {
  return (
    <div className="h-full">
      <TopBar title="Team chat" back />
      <div className="space-y-2.5 px-3">
        <Bubble who="Marco" text="Elios 3 is charged and back in the cabinet." />
        <Bubble who="Léa" text="Thanks! Taking it Monday for the Lyon training." />
        <Bubble who={first} text="Road Days sheet is updated for next week." mine />
      </div>
      <div className="absolute inset-x-0 bottom-[4.25rem] flex items-center gap-2 px-3">
        <div className="flex-1 rounded-full border border-glass/15 bg-glass/8 px-3 py-2 text-[11px] text-ink-4">Message the team…</div>
        <div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-slate-900">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </div>
      </div>
      <TabBar activeTab={activeTab} availableModules={availableModules} />
    </div>
  );
}

function Bubble({ who, text, mine }: { who: string; text: string; mine?: boolean }) {
  return (
    <div className={cn("flex", mine && "justify-end")}>
      <div className={cn("max-w-[82%] rounded-2xl px-3 py-2", mine ? "rounded-br-md bg-accent/20" : "rounded-bl-md bg-panel border border-glass/10")}>
        <p className={cn("text-[9px] font-semibold", mine ? "text-accent-soft" : "text-ink-4")}>{who}</p>
        <p className="text-[11px] leading-snug text-ink">{text}</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- install */

function SafariScreen({ first }: { first: string }) {
  return (
    <div className="h-full bg-surface">
      <div className="px-4 pt-1">
        <p className="text-[12px] font-medium text-ink-3">{timeGreeting()}</p>
        <p className="text-[24px] font-bold leading-[1.1] tracking-tight text-ink">{first}</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5 opacity-60">
          <Tile label="Overtime" value="+6:30" tone="accent" />
          <Tile label="Today" value="--:--" />
          <div className="col-span-2 h-20 rounded-2xl border border-glass/10 bg-panel" />
          <div className="h-11 rounded-2xl border border-glass/10 bg-panel" />
          <div className="h-11 rounded-2xl border border-glass/10 bg-panel" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#1c1c1e] pb-4 pt-2">
        <div className="mx-3 flex items-center gap-2 rounded-xl bg-[#2c2c2e] px-3 py-2 text-[12px] text-white">
          <span className="text-white/50">AA</span>
          <span className="flex-1 text-center font-medium">flya.space</span>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white/70" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a8 8 0 0114-3M19 15a8 8 0 01-14 3" />
          </svg>
        </div>
        <div className="mt-3 flex items-center justify-around px-4 text-[#0a84ff]">
          <SafariGlyph d="M15 19l-7-7 7-7" dim />
          <SafariGlyph d="M9 5l7 7-7 7" dim />
          <Spot id="share-button" className="grid h-9 w-9 place-items-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3m0 0L8 7m4-4l4 4M5 11v9a1 1 0 001 1h12a1 1 0 001-1v-9" />
            </svg>
          </Spot>
          <SafariGlyph d="M4 6h16M4 12h16M4 18h16" />
          <SafariGlyph d="M4 4h16v16H4zM8 8h8v8H8z" />
        </div>
      </div>
    </div>
  );
}

function SafariGlyph({ d, dim }: { d: string; dim?: boolean }) {
  return (
    <span className={cn("grid h-9 w-9 place-items-center", dim && "opacity-40")}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </span>
  );
}

function ShareSheet() {
  const row = "flex items-center justify-between px-4 py-2.5 text-[13px] text-white";
  return (
    <div className="h-full bg-surface">
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-x-0 bottom-0 top-20 rounded-t-[1.4rem] bg-[#1c1c1e]">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <AppIcon size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">Flya Space</p>
            <p className="truncate text-[11px] text-white/50">flya.space</p>
          </div>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 text-[12px] text-white/70">×</span>
        </div>
        <div className="flex gap-4 overflow-hidden border-b border-white/10 px-4 py-3">
          {["Messages", "Mail", "Notes", "Slack"].map((name, index) => (
            <div key={name} className="flex w-12 flex-col items-center gap-1">
              <div className={cn("h-11 w-11 rounded-xl", ["bg-green-500", "bg-sky-500", "bg-amber-300", "bg-purple-500"][index])} />
              <span className="text-[9px] text-white/70">{name}</span>
            </div>
          ))}
        </div>
        <div className="mx-4 mt-3 overflow-hidden rounded-xl bg-[#2c2c2e]">
          <div className={cn(row, "border-b border-white/10")}>Copy <span className="text-white/50">⧉</span></div>
          <div className={cn(row, "border-b border-white/10")}>Add to Reading List <span className="text-white/50">☰</span></div>
          <div className={cn(row, "border-b border-white/10")}>Add Bookmark <span className="text-white/50">📖</span></div>
          <Spot id="add-to-home" className={row}>
            <span className="font-medium">Add to Home Screen</span>
            <span className="grid h-5 w-5 place-items-center rounded border border-white/60 text-[12px] leading-none text-white">+</span>
          </Spot>
        </div>
        <div className="mx-4 mt-3 overflow-hidden rounded-xl bg-[#2c2c2e]">
          <div className={cn(row, "border-b border-white/10")}>Markup <span className="text-white/50">✎</span></div>
          <div className={row}>Print <span className="text-white/50">⎙</span></div>
        </div>
      </div>
    </div>
  );
}

function AppIcon({ size }: { size: number }) {
  return (
    <div className="grid place-items-center rounded-[22%] bg-gradient-to-br from-accent-from to-accent-to shadow-lg" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" className="text-slate-950" style={{ width: size * 0.55, height: size * 0.55 }} fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 14l8-9 8 9M8 14v5h8v-5" />
      </svg>
    </div>
  );
}

const HOME_APPS = ["bg-green-500", "bg-sky-400", "bg-slate-200", "bg-amber-400", "bg-rose-500", "bg-indigo-500", "bg-emerald-400", "bg-neutral-700", "bg-orange-400", "bg-blue-600", "bg-pink-400"];

function HomeScreen() {
  return (
    <div className="h-full bg-[radial-gradient(circle_at_30%_20%,#1d4ed8_0%,#0f172a_45%,#020617_100%)]">
      <div className="grid grid-cols-4 gap-x-3 gap-y-4 px-5 pt-5">
        {HOME_APPS.map((color, index) => (
          <div key={index} className="flex flex-col items-center gap-1">
            <div className={cn("h-12 w-12 rounded-[22%]", color)} />
            <span className="h-2 w-8 rounded bg-white/25" />
          </div>
        ))}
        <Spot id="app-icon" className="flex flex-col items-center gap-1">
          <AppIcon size={48} />
          <span className="text-[9px] font-medium text-white">Flya Space</span>
        </Spot>
      </div>
      <div className="absolute inset-x-4 bottom-4 flex justify-around rounded-[1.6rem] bg-white/15 px-3 py-3 backdrop-blur">
        {["bg-green-500", "bg-sky-400", "bg-[#0a84ff]", "bg-rose-400"].map((color, index) => (
          <div key={index} className={cn("h-12 w-12 rounded-[22%]", color)} />
        ))}
      </div>
    </div>
  );
}
