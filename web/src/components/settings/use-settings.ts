"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleGrant } from "@/lib/role-access";
import type { UserRole } from "@/lib/user-role";
import { useViewParam } from "@/lib/view-params";
import {
  filterSettingsNav,
  settingsAccessFor,
  visibleSettingsNav,
  SETTINGS_SECTION_IDS,
  type GmailStatus,
  type InitialSettings,
  type ReadmeKey,
  type SettingsSectionId,
  type TravelMapping,
} from "./types";

export function useSettings(
  userRole: UserRole,
  isAdmin: boolean,
  moduleGrants: readonly ModuleGrant[],
  autoOpenProgramReadmeToken: number,
  initialData?: InitialSettings | null,
  initialSection?: SettingsSectionId | null,
) {
  const access = useMemo(
    () => settingsAccessFor(userRole, isAdmin, moduleGrants),
    [userRole, isAdmin, moduleGrants],
  );
  // Mirrored into `?section=` so a reload reopens the same settings section.
  const [activeSection, setActiveSection] = useViewParam<SettingsSectionId>(
    "section",
    SETTINGS_SECTION_IDS,
    visibleSettingsNav(access)[0].id,
    initialSection,
  );
  const [navFilter, setNavFilter] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>(
    () => initialData?.gmail ?? { connected: false },
  );
  const [travelMapping, setTravelMapping] = useState<TravelMapping>(
    () =>
      initialData?.travelMapping ?? {
        clientColumn: "",
        locationColumn: "",
        responsibleColumn: "",
      },
  );
  const [mappingSaving, setMappingSaving] = useState(false);
  const [openReadme, setOpenReadme] = useState<ReadmeKey | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Seeded from SSR: the two requests below would only re-fetch what we
  // already have, so skip them entirely on first paint.
  const seededRef = useRef(initialData != null);

  useEffect(() => {
    (async () => {
      if (!access.mail && !access.travel) return;
      if (seededRef.current) {
        seededRef.current = false;
        return;
      }
      const [gmailResponse, mappingResponse] = await Promise.all([
        access.mail ? fetch("/api/gmail/status") : null,
        access.travel ? fetch("/api/settings/travel-mapping") : null,
      ]);
      if (gmailResponse?.ok) {
        const data = (await gmailResponse.json()) as GmailStatus;
        setGmailStatus(data);
      }
      if (mappingResponse?.ok) {
        const mapping = (await mappingResponse.json()) as Partial<Record<keyof TravelMapping, string>>;
        setTravelMapping({
          clientColumn: String(mapping.clientColumn ?? ""),
          locationColumn: String(mapping.locationColumn ?? ""),
          responsibleColumn: String(mapping.responsibleColumn ?? ""),
        });
      }
    })();
  }, [access]);

  async function handleSaveTravelMapping() {
    setMappingSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/travel-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(travelMapping),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save mapping.");
      setMessage("Travel column mapping saved.");
      // Any mounted Time Tracker drops its cached weeks and re-reads the
      // sheet with the new columns.
      window.dispatchEvent(new Event("ma-travel-mapping-changed"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMappingSaving(false);
    }
  }

  async function handleResetTravelMapping() {
    setMappingSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/travel-mapping", { method: "DELETE" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not reset mapping.");
      setTravelMapping({ clientColumn: "", locationColumn: "", responsibleColumn: "" });
      setMessage("Travel mapping cleared. Enter your own columns to see travel info again.");
      window.dispatchEvent(new Event("ma-travel-mapping-changed"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMappingSaving(false);
    }
  }

  async function handleDisconnectGmail() {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/gmail/disconnect", { method: "POST" });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      setError(data.error || "Could not disconnect Gmail.");
      return;
    }
    setGmailStatus({ connected: false });
    setMessage("Gmail disconnected.");
    // The mail composer keeps its own copy of this status (in the shell); tell it.
    window.dispatchEvent(new Event("ma-gmail-status-changed"));
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const response = await fetch("/api/time-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_json", data: parsed }),
      });
      const payload = (await response.json()) as { imported_day_logs?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Import failed");
      const imported = payload.imported_day_logs ?? 0;
      setMessage(`Imported ${String(imported)} days.`);
      window.dispatchEvent(new CustomEvent("time-tracker-imported", { detail: { imported_day_logs: imported } }));
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      window.dispatchEvent(new CustomEvent("time-tracker-imported", { detail: { error: msg } }));
    } finally {
      setImporting(false);
    }
  }

  async function handleExportData() {
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/time-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export_json" }),
      });
      const payload = (await response.json()) as { error?: string; work?: unknown; comp?: unknown };
      if (!response.ok) throw new Error(payload.error || "Export failed");

      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `hourlogger-data-${stamp}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${fileName}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== "DELETE") {
      setError("Type DELETE to confirm account deletion.");
      setMessage(null);
      return;
    }
    setDeletingAccount(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/account/delete", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not delete account.");
      // A full load, not router.push: like sign-out (POST /logout → 303), it
      // must drop the client router cache, which still holds pages rendered
      // for the account that no longer exists.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    } catch (err) {
      setError((err as Error).message || "Could not delete account.");
      setDeletingAccount(false);
    }
  }

  function toggleReadme(key: ReadmeKey) {
    setOpenReadme((prev) => (prev === key ? null : key));
  }

  // Each new token (including one present on mount) opens the program readme.
  const [seenReadmeToken, setSeenReadmeToken] = useState(0);
  if (seenReadmeToken !== autoOpenProgramReadmeToken) {
    setSeenReadmeToken(autoOpenProgramReadmeToken);
    if (autoOpenProgramReadmeToken > 0) {
      setActiveSection("readme");
      setOpenReadme("program");
    }
  }

  const filteredNavItems = useMemo(
    () => filterSettingsNav(access, navFilter),
    [access, navFilter],
  );

  useEffect(() => {
    if (filteredNavItems.length === 0) return;
    if (!filteredNavItems.some((item) => item.id === activeSection)) {
      setActiveSection(filteredNavItems[0].id);
    }
  }, [filteredNavItems, activeSection, setActiveSection]);

  return {
    access,
    activeSection,
    setActiveSection,
    navFilter,
    setNavFilter,
    filteredNavItems,
    message,
    error,
    gmailStatus,
    handleDisconnectGmail,
    travelMapping,
    setTravelMapping,
    mappingSaving,
    handleSaveTravelMapping,
    handleResetTravelMapping,
    importing,
    exporting,
    handleImportFile,
    handleExportData,
    deleteConfirmText,
    setDeleteConfirmText,
    deletingAccount,
    handleDeleteAccount,
    openReadme,
    toggleReadme,
  };
}

export type SettingsState = ReturnType<typeof useSettings>;
