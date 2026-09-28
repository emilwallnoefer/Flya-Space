"use client";

import { Button, Input, Select } from "@/components/ui";
import { addDays, mondayOf } from "@/lib/fleet-rules";
import {
  HOLDER_ANY,
  HOLDER_NOBODY,
  WINDOW_STEP_DAYS,
  type FleetState,
  type FleetTab,
} from "./use-fleet";
import { CATEGORY_LABEL, CATEGORY_ORDER, type FleetAssetCategory } from "./types";

/**
 * Every control the panel has, in one surface.
 *
 * They used to be three separate floating rows — tabs, then filters, then the
 * calendar's own navigation — which put four stacked bands of chrome above the
 * grid and left a lane of dead space down the middle of each one. One bordered
 * block, two rows, reads as the instrument panel it is.
 *
 * The calendar row is part of it rather than part of the calendar tab: it is
 * the same kind of thing as the filters beside it, and hoisting it here is what
 * lets the two rows share a container.
 *
 * ## Widths
 *
 * Every control is sized by a WRAPPER, never by a utility on the control
 * itself. `cn()` carries no tailwind-merge, so a `w-40` passed to `Input` does
 * not replace the `w-full` in the field primitive's base — both land in the
 * class list and `w-full` wins. That is what made these controls full-bleed and
 * stacked. Size the box; let the control fill it.
 */
export function FleetToolbar({
  state,
  tabs,
}: {
  state: FleetState;
  tabs: Array<[FleetTab, string, number | null]>;
}) {
  const {
    tab,
    setTab,
    categoryFilter,
    setCategoryFilter,
    holderFilter,
    setHolderFilter,
    holderOptions,
    search,
    setSearch,
    windowStart,
    setWindowStart,
    today,
    showPast,
    toggleShowPast,
  } = state;

  // The type filter and the search box drive BOTH the calendar rows and the
  // Material register, so they belong to the panel rather than to either tab.
  // They used to live inside the calendar's own toolbar, which meant a filter
  // set there silently trimmed Material with no visible control to explain why.
  const filtersApply = tab === "calendar" || tab === "material";
  const filtered =
    categoryFilter !== "all" || holderFilter !== HOLDER_ANY || search.trim() !== "";

  return (
    <div className="overflow-hidden rounded-xl border border-glass/12 bg-glass/[0.04]">
      {/* --------------------------------------------- sections and filters */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-2 py-2">
        <nav className="flex flex-wrap items-center gap-0.5" role="tablist" aria-label="Fleet sections">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`fleet-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="fleet-tabpanel"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition ease-fluid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent/80 ${
                tab === key
                  ? "bg-accent-deep/30 text-accent-soft ring-1 ring-inset ring-accent/40"
                  : "text-ink-4 hover:bg-glass/10 hover:text-ink-2"
              }`}
            >
              {label}
              {count != null ? (
                <span className="text-[11px] tabular-nums opacity-60">{count}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {filtersApply ? (
          <div className="flex flex-1 items-center justify-end gap-1.5">
            <div className="w-32 shrink-0 sm:w-40">
              <Select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as FleetAssetCategory | "all")}
                className="px-2 py-1.5 text-xs text-ink"
                aria-label="Filter by type"
              >
                <option value="all">All types</option>
                {CATEGORY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABEL[value]}
                  </option>
                ))}
              </Select>
            </div>
            {/* Only offered once somebody actually holds something: a filter
                whose every option is "nobody" is a control that cannot act. */}
            {holderOptions.length > 0 ? (
              <div className="w-32 shrink-0 sm:w-40">
                <Select
                  value={holderFilter}
                  onChange={(event) => setHolderFilter(event.target.value)}
                  className="px-2 py-1.5 text-xs text-ink"
                  aria-label="Filter by who has it"
                >
                  <option value={HOLDER_ANY}>Anyone</option>
                  <option value={HOLDER_NOBODY}>Nobody — free</option>
                  {holderOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="w-36 min-w-0 sm:w-56">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearch("");
                }}
                placeholder="Search name, serial, location…"
                className="px-2 py-1.5 text-xs"
                aria-label="Search material"
              />
            </div>
            {filtered ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("all");
                  setHolderFilter(HOLDER_ANY);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------ calendar controls */}
      {tab === "calendar" ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-glass/[0.08] bg-glass/[0.03] px-2 py-2">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-md border border-glass/15 bg-glass/[0.06]">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setWindowStart(addDays(windowStart, -WINDOW_STEP_DAYS))}
                aria-label={`Back ${WINDOW_STEP_DAYS} days`}
              >
                ←
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setWindowStart(mondayOf(today))}>
                Today
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setWindowStart(addDays(windowStart, WINDOW_STEP_DAYS))}
                aria-label={`Forward ${WINDOW_STEP_DAYS} days`}
              >
                →
              </Button>
            </div>

            {/* Stepping a week at a time makes older history unreachable in
                practice — a year back is 52 clicks. Jump straight there. */}
            <div className="w-[8.75rem] shrink-0">
              <Input
                type="date"
                value={windowStart}
                onChange={(event) => {
                  if (event.target.value) setWindowStart(mondayOf(event.target.value));
                }}
                aria-label="Jump to date"
                className="px-2 py-1.5 text-xs [color-scheme:dark]"
              />
            </div>
          </div>

          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-ink-4 transition hover:text-ink-2">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(event) => toggleShowPast(event.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-accent"
            />
            Show finished bookings
          </label>
        </div>
      ) : null}
    </div>
  );
}
