"use client";

import { useEffect, useRef, useState } from "react";
import { playUiSound } from "@/lib/ui-sounds";
import {
  NAVBAR_CLASS,
  NAVBAR_EYEBROW_CLASS,
  NAVBAR_LOGO_CLASS,
  NAVBAR_MENU_BUTTON_CLASS,
  NAVBAR_TITLE_CLASS,
} from "@/components/workspace-home-layout";

// The Google embeds ("planning", "fleetsheet", "roaddays") open from their home
// cards only; the menu deliberately lists no item for them.
type ModuleKey = "mail" | "time" | "fleet" | "planning" | "fleetsheet" | "roaddays" | "settings" | "admin";

type AuthNavbarProps = {
  activeModule: ModuleKey;
  availableModules?: ModuleKey[];
  adminModuleLabel?: string;
  onSelectModule: (module: ModuleKey) => void;
};

export function AuthNavbar({
  activeModule,
  availableModules = ["mail", "time", "fleet", "settings"],
  adminModuleLabel = "Admin",
  onSelectModule,
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


  return (
    <nav className={NAVBAR_CLASS}>
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex items-center gap-2.5">
          <div className={NAVBAR_LOGO_CLASS}>
            FA
          </div>
          <div className="min-w-0">
            <p className={NAVBAR_EYEBROW_CLASS}>Flyability Internal</p>
            <p className={NAVBAR_TITLE_CLASS}>Flya Allrounder</p>
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              setMenuOpen((prev) => !prev);
            }}
            className={NAVBAR_MENU_BUTTON_CLASS}
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

              {/* Settings and sign-out: set apart from the tools above. */}
              <hr className="my-2.5 border-glass/15" />

              <div className="grid gap-1.5">
                {availableModules.includes("settings") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeModule !== "settings") playUiSound("switchWhoosh");
                      onSelectModule("settings");
                      setMenuOpen(false);
                    }}
                    aria-current={activeModule === "settings" ? "page" : undefined}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium text-ink transition hover:border-accent/70 hover:bg-accent/95 hover:text-slate-900 ${
                      activeModule === "settings" ? "border-accent/55 bg-glass/12" : "border-glass/10 bg-glass/5"
                    }`}
                  >
                    <span>Settings</span>
                    {activeModule === "settings" ? <span className="text-[11px] opacity-80">Active</span> : null}
                  </button>
                ) : null}
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
