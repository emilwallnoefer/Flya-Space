"use client";

import type { ReactNode } from "react";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import { fmtHM, fmtSignedHM } from "@/components/time-tracker/types";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { fromDateKey } from "@/lib/date";
import { greetingFromEmail, timeGreeting } from "@/lib/greeting";
import { cn } from "@/lib/cn";
import { MobileAvatar, MobileTopBar } from "./primitives";
import type { useHomeSummary } from "./use-home-summary";

type Summary = ReturnType<typeof useHomeSummary>;

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });

/**
 * The phone's home: a board of tiles, each one thing, each one tap. Top row
 * is the person's own numbers and actions (overtime bank, today, new mail);
 * then the material with them; then the Google sheets. Only the top row
 * carries a name; the fleet and Google tiles are their glyph and value alone.
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
  const { week, today, myItems } = summary;
  const hasTime = availableModules.includes("time");
  const hasFleet = availableModules.includes("fleet");
  const hasMail = availableModules.includes("mail");

  const logged = week ? week.days.filter((day) => day.net_mins > 0 || day.holiday || day.public_holiday || day.sick_leave) : [];
  const lastLogged = logged.length > 0 ? logged[logged.length - 1] : null;
  const bankMins = week?.overtime_bank_mins ?? null;
  const todayValue =
    today && today.net_mins > 0 ? fmtHM(today.net_mins) : today?.holiday ? "Vacation" : today?.sick_leave ? "Sick" : today?.public_holiday ? "Holiday" : null;

  return (
    <div className="m-screen">
      <MobileTopBar
        large
        title={
          <span className="block pt-1 pb-1">
            <span className="block text-base font-medium text-ink-3">{timeGreeting()}</span>
            <span className="block text-[2rem] font-bold leading-[1.1] tracking-tight text-ink">{greetingFromEmail(email)}</span>
          </span>
        }
        right={<MobileAvatar email={email} onClick={onOpenMore} />}
      />

      <div className="space-y-6 px-4 pt-2">
        {hasTime || hasMail ? (
          <div className={cn("grid gap-3", hasTime && hasMail ? "grid-cols-3" : "grid-cols-2")}>
            {hasTime ? (
              <HomeTile
                label="Overtime"
                value={bankMins === null ? "—" : fmtSignedHM(bankMins)}
                sub={!week ? "" : lastLogged ? `Through ${WEEKDAY.format(fromDateKey(lastLogged.date))}` : "Nothing yet"}
                tone={bankMins === null ? "default" : bankMins >= 0 ? "accent" : "warn"}
                onClick={() => onOpenModule("time")}
              />
            ) : null}
            {hasTime ? (
              <HomeTile
                label="Today"
                icon={<IconClock className="h-4 w-4" />}
                value={todayValue ?? "—"}
                sub={today && today.net_mins > 0 ? `${today.start_time}–${today.stop_time}` : "Log"}
                tone={todayValue ? "positive" : "default"}
                onClick={() => onOpenModule("time", { editToday: true })}
              />
            ) : null}
            {hasMail ? <HomeTile label="New mail" icon={<IconMail className="h-4 w-4" />} value={<IconMail className="h-7 w-7 text-accent-soft" />} onClick={() => onOpenModule("mail")} /> : null}
          </div>
        ) : null}

        {hasFleet ? (
          <section>
            <h2 className="mb-2 px-1 text-sm font-semibold text-ink-3">With you</h2>
            <div className="grid grid-cols-2 gap-3">
              {myItems.map((item) => (
                <HomeTile
                  key={item.id}
                  icon={<IconDrone className="h-4 w-4" />}
                  value={<span className="block truncate text-lg">{item.name}</span>}
                  sub={item.status === "picked_up" ? `Back ${DAY.format(fromDateKey(item.end_date))}` : `From ${DAY.format(fromDateKey(item.start_date))}`}
                  onClick={() => onOpenModule("fleet")}
                />
              ))}
              <HomeTile
                value={<PlusIcon className="h-7 w-7 text-accent-soft" />}
                sub="Book"
                onClick={() => onOpenModule("fleet")}
              />
            </div>
          </section>
        ) : null}

        {embeds.length > 0 ? (
          <section>
            <h2 className="mb-2 px-1 text-sm font-semibold text-ink-3">Google</h2>
            <div className="grid grid-cols-3 gap-3">
              {embeds.map((embed) => (
                <HomeTile
                  key={embed.key}
                  compact
                  aria-label={embed.title}
                  value={embed.key === "roaddays" ? <FormIcon className="h-6 w-6 text-accent-soft" /> : <SheetIcon className="h-6 w-6 text-accent-soft" />}
                  onClick={() => onOpenModule(embed.key)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
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
}: {
  label?: ReactNode;
  "aria-label"?: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "accent" | "positive" | "warn";
  compact?: boolean;
  onClick: () => void;
}) {
  const toneClass = tone === "accent" ? "text-accent-soft" : tone === "positive" ? "text-positive" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
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
