"use client";

import { AppearanceSection } from "@/components/settings/sections/appearance-section";
import { GmailSection } from "@/components/settings/sections/gmail-section";
import { InterfaceSoundsSection } from "@/components/settings/sections/interface-sounds-section";
import { MailSignatureSection } from "@/components/settings/sections/mail-signature-section";
import { ReadmeSection } from "@/components/settings/sections/readme-section";
import { SecuritySection } from "@/components/settings/sections/security-section";
import { TimeDataSection } from "@/components/settings/sections/time-data-section";
import { TravelMappingSection } from "@/components/settings/sections/travel-mapping-section";
import { SETTINGS_NAV, type InitialSettings, type SettingsSectionId } from "@/components/settings/types";
import { useSettings } from "@/components/settings/use-settings";
import type { UserRole } from "@/lib/user-role";
import { useState } from "react";
import { MobileGroup, MobileRow, MobileTopBar } from "../primitives";

const DETAIL: Record<SettingsSectionId, string> = {
  gmail: "Save drafts to Gmail",
  travel_mapping: "Your columns in the planning sheet",
  mail_signature: "How mails sign off",
  time_data: "Import or export your hours",
  appearance: "Skin and accent",
  interface_sounds: "Clicks and whooshes",
  security: "Delete your account",
  readme: "Guides and help",
};

/**
 * Settings on a phone: a grouped list, each row a section screen. The
 * sections are the desktop's own components (they are plain forms), the
 * state is the shared `useSettings`, which also mirrors the open section
 * into `?section=` so a reload lands back on it.
 */
export function MobileSettingsScreen({
  userRole,
  initialData,
  onBack,
}: {
  userRole: UserRole | null;
  initialData: InitialSettings | null;
  onBack: () => void;
}) {
  const s = useSettings(userRole ?? "eu_pilot", 0, initialData);
  const items = SETTINGS_NAV.filter((item) => !item.pilotOnly || !s.isSalesOnly);
  // The list comes first on a phone; the hook always holds a section, so
  // "which one is open" is this screen's own state.
  const [chosen, setChosen] = useState<SettingsSectionId | null>(null);
  const open = chosen && items.some((item) => item.id === chosen) ? chosen : null;
  const title = SETTINGS_NAV.find((n) => n.id === open)?.label ?? "Settings";
  function chooseSection(id: SettingsSectionId | null) {
    setChosen(id);
    if (id) s.setActiveSection(id);
  }

  if (open === null) {
    return (
      <>
        <MobileTopBar title="Settings" onBack={onBack} />
        <div className="space-y-5 px-4 pt-2">
          <MobileGroup>
            {items.map((item) => (
              <MobileRow key={item.id} label={item.label} detail={DETAIL[item.id]} chevron onClick={() => chooseSection(item.id)} />
            ))}
          </MobileGroup>
        </div>
      </>
    );
  }

  return (
    <>
      <MobileTopBar title={title} onBack={() => chooseSection(null)} />
      <div className="px-4 pt-1 pb-4 [&_input]:min-h-11 [&_select]:min-h-11 [&_button]:min-h-10">
        {open === "gmail" ? <GmailSection status={s.gmailStatus} onDisconnect={() => void s.handleDisconnectGmail()} /> : null}
        {open === "mail_signature" ? (
          <MailSignatureSection preset={s.mailSigPreset} custom={s.mailSigCustom} saving={s.mailSigSaving} onPresetChange={s.setMailSigPreset} onCustomChange={s.setMailSigCustom} onSave={() => void s.handleSaveMailSignature()} />
        ) : null}
        {open === "travel_mapping" ? (
          <TravelMappingSection mapping={s.travelMapping} setMapping={s.setTravelMapping} saving={s.mappingSaving} onSave={() => void s.handleSaveTravelMapping()} onReset={() => void s.handleResetTravelMapping()} />
        ) : null}
        {open === "time_data" ? <TimeDataSection importing={s.importing} exporting={s.exporting} onImportFile={(file) => void s.handleImportFile(file)} onExport={() => void s.handleExportData()} /> : null}
        {open === "appearance" ? <AppearanceSection /> : null}
        {open === "interface_sounds" ? <InterfaceSoundsSection /> : null}
        {open === "security" ? <SecuritySection confirmText={s.deleteConfirmText} setConfirmText={s.setDeleteConfirmText} deleting={s.deletingAccount} onDelete={() => void s.handleDeleteAccount()} /> : null}
        {open === "readme" ? <ReadmeSection isSalesOnly={s.isSalesOnly} openReadme={s.openReadme} onToggle={s.toggleReadme} /> : null}
        {s.message ? <p className="mt-6 text-sm text-positive">{s.message}</p> : null}
        {s.error ? <p className="mt-2 text-sm text-danger">{s.error}</p> : null}
      </div>
    </>
  );
}
