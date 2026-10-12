"use client";

import type { CSSProperties, ReactNode } from "react";
import { NAVBAR_TITLE, NAVBAR_TITLE_CLASS } from "@/components/workspace-home-layout";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import { fmtSignedHM } from "@/components/time-tracker/types";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { fromDateKey } from "@/lib/date";
import { greetingFromEmail, timeGreeting } from "@/lib/greeting";
import { cn } from "@/lib/cn";
import { MobileAvatar, MobileHomeHeader, MobileRow } from "./primitives";
import { todayStatus } from "./today-status";
import type { useHomeSummary } from "./use-home-summary";

type Summary = ReturnType<typeof useHomeSummary>;

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });

/**
 * The phone's home, on one two-column grid: the person's two numbers
 * (overtime bank, today), a full-width card of the material with them, then
 * the shortcuts (new mail, the Google sheets) as half-width tiles. One
 * rhythm top to bottom; the wide card is the only deliberate exception.
 *
 * The Google tiles are split: the wide left part opens the sheet framed in
 * the app, the ↗ on the right opens it in Google (the Sheets app or Google's
 * site, with the work account). The frame is blank on most iPhones, see
 * lib/google-embeds.ts, so the link is the way in there.
 */
export function MobileHome({
  email,
  availableModules,
  summary,
  embeds,
  onOpenModule,
  onOpenMore,
}: {
  email: string;
  availableModules: ModuleKey[];
  summary: Summary;
  embeds: Array<{ key: ModuleKey; title: string; href: string }>;
  onOpenModule: (module: ModuleKey, options?: { editToday?: boolean }) => void;
  onOpenMore: () => void;
}) {
  const { week, today, todayKey, myItems } = summary;
  const hasTime = availableModules.includes("time");
  const hasFleet = availableModules.includes("fleet");
  const hasMail = availableModules.includes("mail");

  const logged = week ? week.days.filter((day) => day.net_mins > 0 || day.holiday || day.public_holiday || day.sick_leave) : [];
  const lastLogged = logged.length > 0 ? logged[logged.length - 1] : null;
  const bankMins = week?.overtime_bank_mins ?? null;
  const todayState = todayStatus(today, todayKey);

  const shortcuts: Array<{ key: ModuleKey; label: string; icon: ReactNode; href?: string }> = [
    ...(hasMail ? [{ key: "mail" as const, label: "New mail", icon: <IconMail className="h-5 w-5" /> }] : []),
    ...embeds.map((embed) => ({
      key: embed.key,
      label: embed.key === "planning" ? "Planning" : embed.key === "fleetsheet" ? "Fleet sheet" : "Road Days",
      icon: embed.key === "roaddays" ? <FormIcon className="h-5 w-5" /> : <SheetIcon className="h-5 w-5" />,
      href: embed.href,
    })),
  ];

  return (
    <div className="m-screen">
      <MobileHomeHeader
        brand={
          /* The launch camera's target: the splash title is this, zoomed in. */
          <span className={NAVBAR_TITLE_CLASS} data-launch-target>
            {NAVBAR_TITLE}
          </span>
        }
        greeting={timeGreeting()}
        name={greetingFromEmail(email)}
        right={<MobileAvatar email={email} onClick={onOpenMore} />}
      />

      <div className="grid grid-cols-2 gap-3 px-4 pt-1">
        {hasTime ? (
          <HomeTile
            revealIndex={2}
            label="Overtime"
            value={bankMins === null ? "—" : fmtSignedHM(bankMins)}
            sub={!week ? "" : lastLogged ? `Through ${WEEKDAY.format(fromDateKey(lastLogged.date))}` : "Nothing yet"}
            tone={bankMins === null ? "default" : bankMins >= 0 ? "accent" : "warn"}
            onClick={() => onOpenModule("time")}
          />
        ) : null}
        {hasTime ? (
          <HomeTile
            revealIndex={3}
            label="Today"
            icon={<IconClock className="h-4 w-4" />}
            value={todayState.value}
            sub={todayState.sub}
            tone={todayState.tone}
            onClick={() => onOpenModule("time", { editToday: true })}
          />
        ) : null}

        {hasFleet ? (
          <section className="m-tile col-span-2 overflow-hidden rounded-2xl border border-glass/10 bg-panel" data-launch-reveal style={{ "--reveal-i": 4 } as CSSProperties}>
            <h2 className="px-4 pt-3 pb-1 text-xs font-medium text-ink-4">With you</h2>
            {myItems.length > 0 ? (
              myItems.map((item) => (
                <MobileRow
                  key={item.id}
                  icon={<IconDrone className="h-4 w-4" />}
                  label={item.name}
                  value={item.status === "picked_up" ? `Back ${DAY.format(fromDateKey(item.end_date))}` : `From ${DAY.format(fromDateKey(item.start_date))}`}
                  onClick={() => onOpenModule("fleet")}
                />
              ))
            ) : (
              <MobileRow icon={<IconDrone className="h-4 w-4" />} label="Nothing with you" onClick={() => onOpenModule("fleet")} />
            )}
            <MobileRow icon={<PlusIcon className="h-4 w-4" />} label="Book material" tone="accent" onClick={() => onOpenModule("fleet")} className="border-t border-glass/10" />
          </section>
        ) : null}

        {shortcuts.map((shortcut, index) => (
          <ShortcutTile
            key={shortcut.key}
            revealIndex={5 + index}
            icon={shortcut.icon}
            label={shortcut.label}
            href={shortcut.href}
            onClick={() => onOpenModule(shortcut.key)}
            wide={shortcuts.length % 2 === 1 && index === shortcuts.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A half-width shortcut: a glyph and a name on one line, 56px tall. With
 * `href` it splits: the left two thirds open the module in the app, the right
 * third is a link that opens the same thing in Google, in a new tab.
 */
/** The launch camera's reveal order for a tile (see components/launch-splash.tsx). */
function revealProps(index: number) {
  return { "data-launch-reveal": "", style: { "--reveal-i": index } as CSSProperties };
}

function ShortcutTile({ icon, label, onClick, href, wide, revealIndex }: { icon: ReactNode; label: string; onClick: () => void; href?: string; wide: boolean; revealIndex: number }) {
  const PRESS = "transition-transform duration-150 ease-out active:scale-[0.97] active:duration-100";
  const body = (
    <>
      <span className="shrink-0 text-accent-soft">{icon}</span>
      <span className="truncate text-[15px] font-medium text-ink">{label}</span>
    </>
  );
  if (href) {
    return (
      <div className={cn("m-tile flex min-h-14 min-w-0 overflow-hidden rounded-2xl border border-glass/10 bg-panel", wide && "col-span-2")} {...revealProps(revealIndex)}>
        <button type="button" onClick={onClick} className={cn("flex min-w-0 flex-[2] items-center gap-3 px-4 text-left", PRESS)}>
          {body}
        </button>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label}: open in Google`}
          className={cn("flex flex-1 items-center justify-center border-l border-glass/10 text-sm text-ink-4", PRESS)}
        >
          ↗
        </a>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("m-tile flex min-h-14 min-w-0 items-center gap-3 rounded-2xl border border-glass/10 bg-panel px-4 text-left", PRESS, wide && "col-span-2")}
      {...revealProps(revealIndex)}
    >
      {body}
    </button>
  );
}

/** A home tile: one big thing (a number, a word or a glyph), optionally a name above and one short line under it. */
function HomeTile({
  label,
  "aria-label": ariaLabel,
  value,
  sub,
  icon,
  tone = "default",
  compact = false,
  onClick,
  revealIndex,
}: {
  label?: ReactNode;
  "aria-label"?: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "accent" | "positive" | "warn";
  compact?: boolean;
  onClick: () => void;
  revealIndex?: number;
}) {
  const toneClass = tone === "accent" ? "text-accent-soft" : tone === "positive" ? "text-positive" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      {...(revealIndex === undefined ? {} : revealProps(revealIndex))}
      className={cn(
        "m-tile flex min-w-0 flex-col justify-between rounded-2xl border border-glass/10 bg-panel p-3 text-left transition-transform duration-150 ease-out active:scale-[0.97] active:duration-100",
        compact ? "min-h-[4.75rem] gap-2" : "min-h-[5.75rem] gap-3",
      )}
    >
      {label || icon ? (
        <span className="flex min-w-0 items-center justify-between gap-2 text-xs font-medium text-ink-4">
          <span className="truncate">{label}</span>
          {icon ? <span className="shrink-0 text-ink-5">{icon}</span> : null}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className={cn("block truncate font-semibold tabular-nums leading-tight", compact ? "text-base" : "text-xl", toneClass)}>{value}</span>
        {sub ? <span className="mt-0.5 block truncate text-xs text-ink-4">{sub}</span> : null}
      </span>
    </button>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SheetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9 9.5v10M3.5 14.5h17" />
    </svg>
  );
}

function FormIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path strokeLinecap="round" d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </svg>
  );
}
