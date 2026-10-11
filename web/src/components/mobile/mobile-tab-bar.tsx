"use client";

import type { ReactNode } from "react";
import { ChatBubbleIcon } from "@/components/chat/icons";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { cn } from "@/lib/cn";

export type MobileTab = "mail" | "time" | "fleet" | "chat";

/**
 * The phone's navigation: Time, Mail, Fleet and Chat as icon-only tabs along
 * the bottom edge, in thumb reach (the name is the button's accessible label,
 * not shown). Module items come from `availableModules`
 * (role-clamped on the server). There is no Home tab: every module screen
 * has a back chevron to the home board, and Account and More sit under the
 * person's initials in the top bar.
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
    { key: "chat", label: "Chat", icon: <ChatBubbleIcon className="h-6 w-6" /> },
  ];
  return (
    <nav className="m-tabbar fixed inset-x-0 bottom-0 z-[95] flex items-stretch border-t border-glass/10 bg-surface pb-safe" aria-label="Workspace">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 flex-1 items-center justify-center px-1 transition",
              isActive ? "text-accent-soft" : "text-ink-4 active:text-ink-2",
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </nav>
  );
}
