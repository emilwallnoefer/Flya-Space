"use client";

import { useEffect, useRef, useState } from "react";
import { playUiSound } from "@/lib/ui-sounds";
import { userRoleLabel, type UserRole } from "@/lib/user-role";

type ModuleKey = "mail" | "time" | "fleet" | "stats" | "settings" | "admin";

type AuthNavbarProps = {
  email: string;
  gmailConnected: boolean;
  gmailEmail?: string | null;
  activeModule: ModuleKey;
  availableModules?: ModuleKey[];
  showGmailStatus?: boolean;
  userRole?: UserRole | null;
  adminModuleLabel?: string;
  onSelectModule: (module: ModuleKey) => void;
  /** Opens Team chat. Omitted = no chat entry in the menu. */
  onOpenChat?: () => void;
};

export function AuthNavbar({
  email,
  gmailConnected,
  gmailEmail,
  activeModule,
  availableModules = ["mail", "time", "fleet", "stats", "settings"],
  showGmailStatus = true,
  userRole = null,
  adminModuleLabel = "Admin",
  onSelectModule,
  onOpenChat,
}: AuthNavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const initials = email.slice(0, 2).toUpperCase();
  const statusLabel = gmailConnected ? "Gmail connected" : "Gmail disconnected";

  return (
    <nav className="glass-card sticky top-3 z-[90] !overflow-visible p-2.5 md:p-3">
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent-from to-accent-to text-[11px] font-semibold text-slate-950">
            FA
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/70">Flyability Internal</p>
            <p className="truncate text-xs font-medium md:text-sm">Flya Allrounder</p>
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              setMenuOpen((prev) => !prev);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-1.5 text-xs transition ease-fluid hover:bg-glass/12"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
          >
            <span className="hidden text-ink-2/90 sm:inline">Menu</span>
            <span className="relative grid h-4 w-4 place-items-center" aria-hidden>
              <span
                className={`absolute h-px w-4 rounded-full bg-current transition ease-fluid duration-200 ${
                  menuOpen ? "rotate-45" : "-translate-y-[3px]"
                }`}
              />
              <span
                className={`absolute h-px w-4 rounded-full bg-current transition ease-fluid duration-200 ${
                  menuOpen ? "-rotate-45" : "translate-y-[3px]"
                }`}
              />
            </span>
          </button>

          {menuOpen && (
            <div className="menu-pop absolute right-0 z-[100] mt-2 w-[min(92vw,17.5rem)] rounded-xl border border-glass/15 bg-surface/92 p-2.5 shadow-xl backdrop-blur-xl">
              <div className="mb-2">
                <a
                  href="/onboarding"
                  className="flex w-full items-center justify-between rounded-lg border border-glass/10 bg-glass/5 px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900"
                >
                  <span>Onboarding</span>
                  <span className="text-[11px] opacity-80">Open</span>
                </a>
              </div>
              <p className="mb-1 px-1 text-[11px] uppercase tracking-[0.15em] text-accent-soft/70">Workspace</p>
              <div className="space-y-1" role="tablist" aria-label="Workspace tabs">
                {availableModules.includes("mail") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "mail") playUiSound("switchWhoosh");
                      onSelectModule("mail");
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={activeModule === "mail"}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900 ${
                      activeModule === "mail" ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span>Mail Composer</span>
                    {activeModule === "mail" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
                {availableModules.includes("time") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "time") playUiSound("switchWhoosh");
                      onSelectModule("time");
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={activeModule === "time"}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900 ${
                      activeModule === "time" ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span>Time Tracker</span>
                    {activeModule === "time" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
                {availableModules.includes("fleet") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "fleet") playUiSound("switchWhoosh");
                      onSelectModule("fleet");
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={activeModule === "fleet"}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900 ${
                      activeModule === "fleet" ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      Fleet
                      <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] uppercase tracking-wider text-warn">
                        Beta
                      </span>
                    </span>
                    {activeModule === "fleet" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
                {availableModules.includes("stats") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "stats") playUiSound("switchWhoosh");
                      onSelectModule("stats");
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={activeModule === "stats"}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900 ${
                      activeModule === "stats" ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span>Field stats</span>
                    {activeModule === "stats" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
                {availableModules.includes("settings") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "settings") playUiSound("switchWhoosh");
                      onSelectModule("settings");
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={activeModule === "settings"}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900 ${
                      activeModule === "settings" ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span>Settings</span>
                    {activeModule === "settings" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
                {availableModules.includes("admin") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "admin") playUiSound("switchWhoosh");
                      onSelectModule("admin");
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={activeModule === "admin"}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-amber-300/70 hover:bg-amber-400/95 hover:text-slate-900 ${
                      activeModule === "admin" ? "border-amber-300/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span>{adminModuleLabel}</span>
                    {activeModule === "admin" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
              </div>

              {onOpenChat ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChat();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-glass/10 bg-glass/5 px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900"
                  >
                    <span>Team chat</span>
                    <span className="text-[11px] opacity-80">Open</span>
                  </button>
                </div>
              ) : null}

              {showGmailStatus ? (
                <div className="mt-2 rounded-lg border border-glass/10 bg-glass/5 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${gmailConnected ? "bg-emerald-300" : "bg-rose-300"}`}
                      aria-hidden="true"
                    />
                    <p className="text-xs text-ink/90">{statusLabel}</p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-accent-from to-accent-to text-[11px] font-semibold text-slate-950">
                      {initials}
                    </span>
                    <p className="truncate text-xs text-ink-2/85">{gmailEmail ?? email}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-glass/10 bg-glass/5 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-accent-from to-accent-to text-[11px] font-semibold text-slate-950">
                      {initials}
                    </span>
                    <p className="truncate text-xs text-ink-2/85">{email}</p>
                  </div>
                </div>
              )}

              <div className="mt-2 rounded-lg border border-glass/10 bg-glass/5 px-2.5 py-2">
                <p className="text-[11px] uppercase tracking-[0.15em] text-ink-3/75">Logged in as</p>
                <p className="mt-1 text-xs font-medium text-ink">
                  {userRoleLabel(userRole ?? null)}
                </p>
              </div>

              <div className="mt-2 grid gap-1.5">
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-glass/15 bg-glass/8 px-2.5 py-2 text-left text-xs transition hover:bg-glass/12"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
