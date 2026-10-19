"use client";

import { m } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Notice, Textarea } from "@/components/ui";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { AssetIcon } from "./asset-icon";
import { ChoiceChips, ChoiceOrCustom, type Choice } from "./choice";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  STATUS_LABEL,
  type FleetAsset,
  type FleetAssetCategory,
  type FleetAssetStatus,
} from "./types";

/**
 * Add a unit, or edit one. The same dialog either way.
 *
 * There used to be two: a six-field grid that expanded above the list to add,
 * and a different three-column grid that expanded inside a row to edit — same
 * fields, two layouts, and neither could see the other's defaults. One dialog
 * means the shape of a unit is described once.
 *
 * Only four things here are typed: the name, the serial, the model and the
 * notes. Everything else has a known set of answers already in the fleet, so it
 * is chosen. See `choice.tsx` for why that is not just a convenience.
 */

export type AssetDraft = {
  name: string;
  serial_number: string;
  category: FleetAssetCategory;
  model: string;
  owner_group: string;
  pooled: boolean;
  current_holder_label: string;
  home_location: string;
  current_location: string;
  notes: string;
  status?: FleetAssetStatus;
};

const BLANK: AssetDraft = {
  name: "",
  serial_number: "",
  category: "drone",
  model: "",
  owner_group: "",
  pooled: true,
  current_holder_label: "",
  home_location: "",
  current_location: "",
  notes: "",
};

const CATEGORY_CHOICES: ReadonlyArray<Choice<FleetAssetCategory>> = CATEGORY_ORDER.map((value) => ({
  value,
  label: CATEGORY_LABEL[value],
  icon: <AssetIcon category={value} className="h-3.5 w-3.5 shrink-0" />,
}));

const STATUS_CHOICES: ReadonlyArray<Choice<FleetAssetStatus>> = (
  Object.keys(STATUS_LABEL) as FleetAssetStatus[]
).map((value) => ({ value, label: STATUS_LABEL[value] }));

const POOLED_CHOICES: ReadonlyArray<Choice<"pooled" | "assigned">> = [
  {
    value: "pooled",
    label: "Bookable by everyone",
    hint: "Appears in the shared calendar",
  },
  {
    value: "assigned",
    label: "Assigned to one person",
    hint: "Stays out of the calendar",
  },
];

export function AssetDialog({
  asset,
  people,
  locations,
  ownerGroups,
  models,
  busy,
  onSave,
  onClose,
}: {
  /** The unit being edited, or null to add a new one. */
  asset: FleetAsset | null;
  /** Names already holding material, offered instead of retyping one. */
  people: readonly string[];
  locations: readonly string[];
  ownerGroups: readonly string[];
  models: readonly string[];
  busy: boolean;
  onSave: (draft: AssetDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AssetDraft>(() =>
    asset
      ? {
          name: asset.name,
          serial_number: asset.serial_number ?? "",
          category: asset.category,
          model: asset.model ?? "",
          owner_group: asset.owner_group ?? "",
          pooled: asset.pooled,
          current_holder_label: asset.current_holder_label ?? "",
          home_location: asset.home_location ?? "",
          current_location: asset.current_location ?? "",
          notes: asset.notes ?? "",
          status: asset.status,
        }
      : BLANK,
  );
  const [attempted, setAttempted] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof AssetDraft>(key: K, value: AssetDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!draft.name.trim()) list.push("Give the unit a name or id.");
    if (!draft.pooled && !draft.current_holder_label.trim()) {
      list.push("An assigned unit needs a person, or nobody will know who has it.");
    }
    return list;
  }, [draft]);

  async function save() {
    setAttempted(true);
    if (problems.length > 0) return;
    if (await onSave(draft)) onClose();
  }

  return (
    <>
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[140] bg-overlay/60 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <m.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={asset ? `Edit ${asset.name}` : "Add material"}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="fixed left-1/2 top-1/2 z-[141] flex max-h-[min(88dvh,46rem)] w-[min(94vw,38rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-glass/12 bg-panel shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        <header className="flex items-center gap-2.5 border-b border-glass/10 px-4 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass/10 ring-1 ring-inset ring-glass/15">
            <AssetIcon category={draft.category} className="h-4 w-4 text-ink-3" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-ink">
              {asset ? asset.name : "Add material"}
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-4">
              {asset
                ? "Changes show up in everyone’s calendar straight away."
                : "Anything you add becomes bookable for everyone."}
            </p>
          </div>
          <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3.5">
          {/* ------------------------------------------------------ identity */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.15em] text-ink-3/75">
              Name or unit id
              <Input
                value={draft.name}
                autoFocus={!asset}
                onChange={(event) => set("name", event.target.value)}
                placeholder="SVA-412"
                className="px-2 py-1.5 text-xs"
                spellCheck={false}
              />
            </label>
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.15em] text-ink-3/75">
              Serial number
              <Input
                value={draft.serial_number}
                onChange={(event) => set("serial_number", event.target.value)}
                placeholder="E300SA23200412"
                className="px-2 py-1.5 text-xs"
                spellCheck={false}
              />
            </label>
          </div>

          <ChoiceChips
            label="Type"
            value={draft.category}
            options={CATEGORY_CHOICES}
            onChange={(value) => set("category", value)}
          />

          {/* The model is also what makes units interchangeable: when one is
              taken, every free unit of the same model is offered instead
              (owner decision 2026-10-19), so there is nothing else to set.
              Spelling differences are folded by the server; a unit with no
              model is never offered. */}
          <ChoiceOrCustom
            label="Model"
            value={draft.model}
            options={models}
            onChange={(value) => set("model", value)}
            placeholder="Elios 3"
            allowEmpty
            emptyLabel="Not recorded"
          />

          {/* ------------------------------------------------- who can use it */}
          <ChoiceChips
            label="Who can use it"
            value={draft.pooled ? "pooled" : "assigned"}
            options={POOLED_CHOICES}
            onChange={(value) => {
              const pooled = value === "pooled";
              setDraft((d) => ({
                ...d,
                pooled,
                // Leaving the pool clears the locations rather than saving them
                // from fields that are no longer on screen — a value nobody can
                // see and nobody will maintain is the definition of stale data.
                current_location: pooled ? d.current_location : "",
                home_location: pooled ? d.home_location : "",
              }));
            }}
            columns
          />

          {!draft.pooled ? (
            <ChoiceOrCustom
              label="Assigned to"
              value={draft.current_holder_label}
              options={people}
              onChange={(value) => set("current_holder_label", value)}
              placeholder="Name of the person or team"
            />
          ) : null}

          {/* ------------------------------------------------------- where */}
          {/* Locations are a fact about the shared pool only. Pooled kit sits
              somewhere between jobs and the next person has to find it; a unit
              assigned to one person travels with them permanently, so a
              location on it would be stale the day after it was entered and
              would have to be maintained forever to stay a lie. Not asking is
              the fix. */}
          {draft.pooled ? (
            <>
              <ChoiceOrCustom
                label="Current location"
                value={draft.current_location}
                options={locations}
                onChange={(value) => set("current_location", value)}
                placeholder="Lausanne"
                allowEmpty
                emptyLabel="Unknown"
              />

              <ChoiceOrCustom
                label="Home location"
                value={draft.home_location}
                options={locations}
                onChange={(value) => set("home_location", value)}
                placeholder="Where it lives between jobs"
                allowEmpty
                emptyLabel="None"
              />
            </>
          ) : null}

          <ChoiceOrCustom
            label="Owner group"
            value={draft.owner_group}
            options={ownerGroups}
            onChange={(value) => set("owner_group", value)}
            placeholder="EMEA"
            allowEmpty
            emptyLabel="None"
          />

          {/* Status is a consequence of bookings for most of a unit's life, so
              it is offered only on an existing one — and mostly to take a unit
              out of service, which no booking can do. */}
          {asset ? (
            <ChoiceChips
              label="Status"
              value={draft.status ?? asset.status}
              options={STATUS_CHOICES}
              onChange={(value) => set("status", value)}
            />
          ) : null}

          <label className="grid gap-1 text-[11px] uppercase tracking-[0.15em] text-ink-3/75">
            Notes
            <Textarea
              value={draft.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={2}
              placeholder="Anything the next person should know"
              className="px-2 py-1.5 text-xs"
            />
          </label>

          {attempted && problems.length > 0 ? (
            <Notice tone="warn" className="text-xs">
              {problems.join(" ")}
            </Notice>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-glass/10 px-4 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="accent" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : asset ? "Save changes" : "Add material"}
          </Button>
        </footer>
      </m.div>
    </>
  );
}
