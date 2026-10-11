"use client";

import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import { HOME_CARDS } from "@/components/workspace-home-layout";
import { fmtSignedHM } from "@/components/time-tracker/types";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { fromDateKey } from "@/lib/date";
import { greetingFromEmail, timeGreeting } from "@/lib/greeting";
import { cn } from "@/lib/cn";
import { MobileGroup, MobileRow, MobileTopBar } from "./primitives";
import type { useHomeSummary } from "./use-home-summary";

type Summary = ReturnType<typeof useHomeSummary>;

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });

/**
 * The phone's home: a status screen, not a dashboard. It answers the two
 * things a pilot checks before leaving the hotel: am I in credit (the
 * overtime bank, large), and do I have my gear (the material actually with
 * me, by name). Then the Google sheets, then one action. Everything that is
 * about the team rather than the person (field stats) lives under More.
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
  embeds: Array<{ key: ModuleKey; title: string }>;
  onOpenModule: (module: ModuleKey, options?: { editToday?: boolean }) => void;
  onOpenMore: () => void;
}) {
  const { week, myItems } = summary;
  const initials = greetingFromEmail(email).slice(0, 1);
  const hasTime = availableModules.includes("time");
  const hasFleet = availableModules.includes("fleet");
  const hasMail = availableModules.includes("mail");

  const logged = week ? week.days.filter((day) => day.net_mins > 0 || day.holiday || day.public_holiday || day.sick_leave) : [];
  const lastLogged = logged.length > 0 ? logged[logged.length - 1] : null;
  const bankMins = week?.overtime_bank_mins ?? null;

  return (
    <div className="m-screen">
      <MobileTopBar
        large
        title={
          <span className="block">
            <span className="block text-[11px] font-medium uppercase tracking-[0.2em] text-accent-soft/70">{timeGreeting()}</span>
            <span className="block">{greetingFromEmail(email)}</span>
          </span>
        }
        right={
          <button
            type="button"
            onClick={onOpenMore}
            aria-label="Account and more"
            className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-accent-from to-accent-to text-sm font-semibold text-slate-950"
          >
            {initials}
          </button>
        }
      />

      <div className="space-y-5 px-4 pt-2">
        {hasTime ? (
          <button
            type="button"
            onClick={() => onOpenModule("time")}
            className="m-tile block w-full rounded-2xl border border-glass/10 bg-panel px-5 py-5 text-left active:bg-glass/8"
          >
            <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-4">
              <IconClock className="h-3.5 w-3.5" />
              Overtime bank
            </span>
            <span
              className={cn(
                "mt-2 block text-4xl font-semibold tabular-nums leading-none",
                bankMins === null ? "text-ink-4" : bankMins >= 0 ? "text-accent-soft" : "text-warn",
              )}
            >
              {bankMins === null ? "—" : fmtSignedHM(bankMins)}
            </span>
            <span className="mt-2 block text-xs text-ink-4">
              {!week
                ? "Loading…"
                : lastLogged
                  ? `Logged through ${WEEKDAY.format(fromDateKey(lastLogged.date))} · ${logged.length} of 5 days this week`
                  : "Nothing logged this week yet"}
            </span>
          </button>
        ) : null}

        {hasFleet ? (
          <MobileGroup title="With you">
            {myItems.length > 0 ? (
              myItems.map((item) => (
                <MobileRow
                  key={item.id}
                  icon={<IconDrone className="h-4 w-4" />}
                  label={item.name}
                  detail={
                    item.status === "picked_up"
                      ? `With you · back ${DAY.format(fromDateKey(item.end_date))}`
                      : `Booked ${DAY.format(fromDateKey(item.start_date))} – ${DAY.format(fromDateKey(item.end_date))}`
                  }
                  chevron
                  onClick={() => onOpenModule("fleet")}
                />
              ))
            ) : (
              <MobileRow icon={<IconDrone className="h-4 w-4" />} label="Nothing booked" detail="Book drones and payloads by the day" chevron onClick={() => onOpenModule("fleet")} />
            )}
          </MobileGroup>
        ) : null}

        {embeds.length > 0 ? (
          <MobileGroup title="Google">
            {embeds.map((embed) => (
              <MobileRow key={embed.key} label={embed.title} detail={HOME_CARDS.find((card) => card.key === embed.key)?.description} chevron onClick={() => onOpenModule(embed.key)} />
            ))}
          </MobileGroup>
        ) : null}

        {hasTime || hasMail ? (
          <MobileGroup title="Actions">
            {hasTime ? <MobileRow icon={<IconClock className="h-4 w-4" />} label="Log today" detail="Start, stop, breaks" chevron onClick={() => onOpenModule("time", { editToday: true })} /> : null}
            {hasMail ? <MobileRow icon={<IconMail className="h-4 w-4" />} label="New training mail" detail="Draft and hand off to Gmail" chevron onClick={() => onOpenModule("mail")} /> : null}
          </MobileGroup>
        ) : null}
      </div>
    </div>
  );
}
