"use client";

import type { ReactNode } from "react";
import { ChatBubbleIcon } from "@/components/chat/icons";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { cn } from "@/lib/cn";

export type MobileTab = "mail" | "time" | "fleet" | "chat";

/**
 * The phone's navigation: the three modules as tabs along the bottom edge,
 * and Chat as a floating pill at the end of the row, since it opens over
 * whatever is on screen rather than replacing it. Items come from
 * `availableModules` (role-clamped on the server). There is no Home tab:
 * every module screen has a back chevron to the home board, and Account and
 * More sit under the person's initials in the top bar.
 */
export function MobileTabBar({
  active,
  availableModules,
  onSelect,
  hidden = false,
}: {
  active: MobileTab | null;
  availableModules: ModuleKey[];
  onSelect: (tab: MobileTab) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const items: Array<{ key: MobileTab; label: string; icon: ReactNode }> = [
    { key: "time", label: "Time", icon: <IconClock className="h-6 w-6" /> },
    ...(availableModules.includes("mail") ? [{ key: "mail" as const, label: "Mail", icon: <IconMail className="h-6 w-6" /> }] : []),
    ...(availableModules.includes("fleet") ? [{ key: "fleet" as const, label: "Fleet", icon: <IconDrone className="h-6 w-6" /> }] : []),
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
      <div className="flex shrink-0 items-center py-1.5 pl-1 pr-3">
        <button
          type="button"
          onClick={() => onSelect("chat")}
          className="m-chat-pill flex h-11 items-center gap-1.5 rounded-full bg-gradient-to-br from-accent-from to-accent-to px-4 text-sm font-semibold text-slate-950 shadow-lg shadow-black/20 active:brightness-95"
        >
          <ChatBubbleIcon className="h-5 w-5" />
          Chat
        </button>
      </div>
    </nav>
  );
}
