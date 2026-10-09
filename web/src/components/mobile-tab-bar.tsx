"use client";

import { useState } from "react";
import { ChatBubbleIcon } from "@/components/chat/icons";
import { IconClock, IconDrone, IconMail } from "@/components/module-icons";
import { MOBILE_TAB_BAR_CLASS, MOBILE_TAB_ITEM_CLASS } from "@/components/workspace-home-layout";
import type { ModuleKey } from "@/lib/dashboard-modules";
import { playUiSound } from "@/lib/ui-sounds";

type MobileTabBarProps = {
  /** The open module, or null on the workspace home. */
  activeModule: ModuleKey | null;
  /** Role-clamped on the server; the bar never invents an item. */
  availableModules: ModuleKey[];
  adminModuleLabel: string;
  /** Hidden while something full-screen (a Google embed, the chat) owns the bottom edge. */
  hidden: boolean;
  onHome: () => void;
  onSelectModule: (module: ModuleKey) => void;
  onOpenChat: () => void;
};

/**
 * The phone navigation: a tab bar along the bottom edge, in thumb reach,
 * for the modules the role can open. Desktop keeps the navbar menu — this
 * component is `sm:hidden` through MOBILE_TAB_BAR_CLASS, so both are in the
 * tree and CSS picks one before first paint. The Google sheets and form stay
 * on their home cards, as on desktop; "More" holds the rest of the menu.
 */
export function MobileTabBar({
  activeModule,
  availableModules,
  adminModuleLabel,
  hidden,
  onHome,
  onSelectModule,
  onOpenChat,
}: MobileTabBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (hidden) return null;

  const tabClass = (active: boolean) =>
    `${MOBILE_TAB_ITEM_CLASS} ${active ? "text-accent-soft" : "active:text-ink-2"}`;

  function select(module: ModuleKey) {
    setMoreOpen(false);
    if (activeModule !== module) playUiSound("switchWhoosh");
    onSelectModule(module);
  }

  return (
    <>
      {moreOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-[94] bg-overlay/40 sm:hidden"
        />
      ) : null}
      <nav className={MOBILE_TAB_BAR_CLASS} aria-label="Workspace">
        <button type="button" onClick={() => { setMoreOpen(false); onHome(); }} className={tabClass(activeModule === null)} aria-current={activeModule === null ? "page" : undefined}>
          <IconHome className="h-5 w-5" />
          Home
        </button>
        {availableModules.includes("mail") ? (
          <button type="button" onClick={() => select("mail")} className={tabClass(activeModule === "mail")} aria-current={activeModule === "mail" ? "page" : undefined}>
            <IconMail className="h-5 w-5" />
            Mail
          </button>
        ) : null}
        <button type="button" onClick={() => select("time")} className={tabClass(activeModule === "time")} aria-current={activeModule === "time" ? "page" : undefined}>
          <IconClock className="h-5 w-5" />
          Time
        </button>
        {availableModules.includes("fleet") ? (
          <button type="button" onClick={() => select("fleet")} className={tabClass(activeModule === "fleet")} aria-current={activeModule === "fleet" ? "page" : undefined}>
            <IconDrone className="h-5 w-5" />
            Fleet
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            playUiSound("switchWhoosh");
            onOpenChat();
          }}
          className={tabClass(false)}
        >
          <ChatBubbleIcon className="h-5 w-5" />
          Chat
        </button>
        <div className="relative flex min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className={tabClass(moreOpen || activeModule === "settings" || activeModule === "admin")}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <IconMore className="h-5 w-5" />
            More
          </button>
          {moreOpen ? (
            <div
              role="menu"
              className="menu-pop absolute bottom-full right-1 z-[96] mb-3 w-[min(92vw,16rem)] rounded-xl border border-glass/15 bg-surface/95 p-2 shadow-xl backdrop-blur-xl"
            >
              <a
                href="/onboarding"
                role="menuitem"
                className="flex w-full items-center justify-between rounded-lg border border-glass/10 bg-glass/5 px-3 py-3 text-left text-sm font-medium text-ink"
              >
                <span>Onboarding</span>
                <span className="text-[11px] opacity-80">Open</span>
              </a>
              {availableModules.includes("admin") ? (
                <button type="button" role="menuitem" onClick={() => select("admin")} className={moreItemClass(activeModule === "admin")}>
                  <span>{adminModuleLabel}</span>
                  {activeModule === "admin" ? <span className="text-[11px] opacity-80">Active</span> : null}
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => select("settings")} className={moreItemClass(activeModule === "settings")}>
                <span>Settings</span>
                {activeModule === "settings" ? <span className="text-[11px] opacity-80">Active</span> : null}
              </button>
              <form action="/logout" method="post" className="mt-2 border-t border-glass/10 pt-2">
                <button
                  type="submit"
                  role="menuitem"
                  className="w-full rounded-lg border border-glass/15 bg-glass/8 px-3 py-3 text-left text-sm"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </nav>
    </>
  );
}

function moreItemClass(active: boolean): string {
  return `mt-1 flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm font-medium text-ink ${
    active ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
  }`;
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.25 12 4l9 7.25M5.25 9.75V19.5h4.5v-5.25h4.5v5.25h4.5V9.75" />
    </svg>
  );
}

function IconMore({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
