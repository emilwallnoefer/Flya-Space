"use client";

import type { ReactNode } from "react";
import { ChatBubbleIcon } from "@/components/chat/icons";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { cn } from "@/lib/cn";

export type MobileTab = "home" | "mail" | "time" | "fleet" | "chat" | "more";

/**
 * The phone's navigation: a tab bar along the bottom edge, in thumb reach.
 * Items come from `availableModules` (role-clamped on the server), so the bar
 * never shows a module the role cannot open. The Google sheets and form stay
 * on their home cards, as on desktop; everything else is under More.
 */
export function MobileTabBar({
  active,
  availableModules,
  onSelect,
  hidden = false,
}: {
  active: MobileTab;
  availableModules: ModuleKey[];
  onSelect: (tab: MobileTab) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const items: Array<{ key: MobileTab; label: string; icon: ReactNode }> = [
    { key: "home", label: "Home", icon: <HomeIcon className="h-6 w-6" /> },
    ...(availableModules.includes("mail") ? [{ key: "mail" as const, label: "Mail", icon: <IconMail className="h-6 w-6" /> }] : []),
    { key: "time", label: "Time", icon: <IconClock className="h-6 w-6" /> },
    ...(availableModules.includes("fleet") ? [{ key: "fleet" as const, label: "Fleet", icon: <IconDrone className="h-6 w-6" /> }] : []),
    { key: "chat", label: "Chat", icon: <ChatBubbleIcon className="h-6 w-6" /> },
    { key: "more", label: "More", icon: <MoreIcon className="h-6 w-6" /> },
  ];
  return (
    <nav className="m-tabbar fixed inset-x-0 bottom-0 z-[95] flex items-stretch border-t border-glass/10 bg-surface/95 pb-safe backdrop-blur-md" aria-label="Workspace">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10.5px] font-medium leading-none transition",
              isActive ? "text-accent-soft" : "text-ink-4 active:text-ink-2",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.25 12 4l9 7.25M5.25 9.75V19.5h4.5v-5.25h4.5v5.25h4.5V9.75" />
    </svg>
  );
}

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
