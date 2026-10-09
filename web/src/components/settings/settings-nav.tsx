"use client";

import type { SettingsSectionId } from "./types";

type SettingsNavProps = {
  showStandaloneActions: boolean;
  navFilter: string;
  setNavFilter: (value: string) => void;
  items: { id: SettingsSectionId; label: string }[];
  activeSection: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
};

export function SettingsNav({
  showStandaloneActions,
  navFilter,
  setNavFilter,
  items,
  activeSection,
  onSelect,
}: SettingsNavProps) {
  return (
    <nav
      className="shrink-0 border-b border-glass/10 bg-overlay/40 md:w-[min(100%,240px)] md:border-b-0 md:border-r md:border-glass/10"
      aria-label="Settings categories"
    >
      <div className="border-b border-glass/10 px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-5">
        <h1 className="text-base font-semibold uppercase tracking-[0.15em] text-ink md:text-lg">
          Settings
        </h1>
        {showStandaloneActions ? (
          <a
            href="/dashboard"
            className="mt-2 inline-block rounded-md border border-glass/15 bg-glass/8 px-2.5 py-1.5 text-[11px] text-ink-2 transition hover:bg-glass/12"
          >
            Back to dashboard
          </a>
        ) : null}
      </div>
      <div className="p-3 pb-2 md:px-4">
        <label className="sr-only" htmlFor="settings-find">
          Find a setting
        </label>
        <input
          id="settings-find"
          type="search"
          value={navFilter}
          onChange={(e) => setNavFilter(e.target.value)}
          placeholder="Find a setting"
          autoComplete="off"
          className="w-full rounded-lg border border-glass/15 bg-glass/5 py-2 pl-3 pr-2 text-xs text-ink-2 placeholder:text-ink-5 focus:border-accent/40 focus:outline-none"
        />
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-5 md:px-4">No settings match your search.</p>
      ) : (
        <ul className="max-h-[42vh] overflow-y-auto px-0 pb-3 md:max-h-[calc(70vh-120px)] md:pb-4" role="list">
          {items.map((item) => {
            const active = activeSection === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center border-l-[3px] px-3 py-2.5 text-left text-sm transition ${
                    active
                      ? "border-accent bg-accent-deep/15 font-medium text-ink"
                      : "border-transparent text-ink-4 hover:bg-glass/[0.06] hover:text-ink-2"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
