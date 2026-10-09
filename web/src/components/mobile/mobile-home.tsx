"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import { HOME_CARDS } from "@/components/workspace-home-layout";
import { fmtHM, fmtSignedHM } from "@/components/time-tracker/types";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { greetingFromEmail, timeGreeting } from "@/lib/greeting";
import { userRoleLabel, type UserRole } from "@/lib/user-role";
import { ChevronIcon, MobileGroup, MobileRow, MobileTile, MobileTopBar } from "./primitives";
import type { useHomeSummary } from "./use-home-summary";

const FieldStatsPanel = dynamic(() => import("@/components/field-stats/field-stats-panel").then((m) => m.FieldStatsPanel), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-xl bg-glass/5" aria-hidden />,
});

type Summary = ReturnType<typeof useHomeSummary>;

/**
 * The phone's home: a glance, not a landing page. The greeting is one line,
 * the numbers that matter today are tiles, the things people open on the
 * road are one tap away, and the Google sheets/form keep their cards.
 */
export function MobileHome({
  email,
  role,
  availableModules,
  summary,
  embeds,
  onOpenModule,
  onOpenMore,
}: {
  email: string;
  role: UserRole | null;
  availableModules: ModuleKey[];
  summary: Summary;
  embeds: Array<{ key: ModuleKey; title: string }>;
  onOpenModule: (module: ModuleKey) => void;
  onOpenMore: () => void;
}) {
  const [teamOpen, setTeamOpen] = useState(false);
  const { week, today, myLive, myOut } = summary;
  const initials = greetingFromEmail(email).slice(0, 1);
  const hasTime = availableModules.includes("time");
  const hasFleet = availableModules.includes("fleet");
  const hasMail = availableModules.includes("mail");

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
        {role ? <p className="text-xs text-ink-4">{userRoleLabel(role)}</p> : null}

        {hasTime ? (
          <div className="grid grid-cols-2 gap-3">
            <MobileTile
              label="Today"
              value={today && today.net_mins > 0 ? fmtHM(today.net_mins) : today?.holiday ? "Vacation" : today?.sick_leave ? "Sick" : today?.public_holiday ? "Holiday" : "—"}
              detail={today && today.net_mins > 0 ? `${today.start_time}–${today.stop_time}` : "Not logged yet"}
              tone={today && today.net_mins > 0 ? "positive" : "default"}
              onClick={() => onOpenModule("time")}
              icon={<IconClock className="h-4 w-4" />}
            />
            <MobileTile
              label="This week"
              value={week ? fmtHM(week.week_hours_mins) : "—"}
              detail={week ? `of ${fmtHM(week.target_mins * 5)} target` : "Loading…"}
              onClick={() => onOpenModule("time")}
            />
            <MobileTile
              label="Overtime bank"
              value={week ? fmtSignedHM(week.overtime_bank_mins) : "—"}
              tone={week ? (week.overtime_bank_mins >= 0 ? "accent" : "warn") : "default"}
              onClick={() => onOpenModule("time")}
            />
            {hasFleet ? (
              <MobileTile
                label="My material"
                value={myLive.length}
                detail={myOut.length > 0 ? `${myOut.length} with you now` : myLive.length > 0 ? "Booked, not picked up" : "Nothing booked"}
                onClick={() => onOpenModule("fleet")}
                icon={<IconDrone className="h-4 w-4" />}
              />
            ) : null}
          </div>
        ) : null}

        <MobileGroup title="Quick actions">
          {hasTime ? <MobileRow icon={<IconClock className="h-4 w-4" />} label="Log today" detail="Start, stop, breaks" chevron onClick={() => onOpenModule("time")} /> : null}
          {hasFleet ? <MobileRow icon={<IconDrone className="h-4 w-4" />} label="Book material" detail="Drones and payloads by the day" chevron onClick={() => onOpenModule("fleet")} /> : null}
          {hasMail ? <MobileRow icon={<IconMail className="h-4 w-4" />} label="New training mail" detail="Draft and hand off to Gmail" chevron onClick={() => onOpenModule("mail")} /> : null}
        </MobileGroup>

        {embeds.length > 0 ? (
          <MobileGroup title="Google">
            {embeds.map((embed) => (
              <MobileRow key={embed.key} label={embed.title} detail={HOME_CARDS.find((card) => card.key === embed.key)?.description} chevron onClick={() => onOpenModule(embed.key)} />
            ))}
          </MobileGroup>
        ) : null}

        <MobileGroup title="Team">
          <button type="button" onClick={() => setTeamOpen((open) => !open)} className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-glass/8" aria-expanded={teamOpen}>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-ink">Team in the field</span>
              <span className="mt-0.5 block text-xs text-ink-4">Regions, POCs and trainings this year</span>
            </span>
            <ChevronIcon className={`h-4 w-4 shrink-0 text-ink-5 transition ${teamOpen ? "rotate-90" : ""}`} />
          </button>
          {teamOpen ? (
            <div className="px-2 pb-2">
              <FieldStatsPanel />
            </div>
          ) : null}
        </MobileGroup>
      </div>
    </div>
  );
}
