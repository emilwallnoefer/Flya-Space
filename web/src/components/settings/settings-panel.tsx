"use client";

import { SETTINGS_NAV, type SettingsPanelProps } from "./types";
import { useSettings } from "./use-settings";
import { SettingsNav } from "./settings-nav";
import { GmailSection } from "./sections/gmail-section";
import { MailSignatureSection } from "./sections/mail-signature-section";
import { TravelMappingSection } from "./sections/travel-mapping-section";
import { TimeDataSection } from "./sections/time-data-section";
import { AppearanceSection } from "./sections/appearance-section";
import { InterfaceSoundsSection } from "./sections/interface-sounds-section";
import { SecuritySection } from "./sections/security-section";
import { ReadmeSection } from "./sections/readme-section";

export function SettingsPanel({
  email: _email,
  showStandaloneActions = false,
  autoOpenProgramReadmeToken = 0,
  userRole = "eu_pilot",
  initialData = null,
  initialSection = null,
}: SettingsPanelProps) {
  const s = useSettings(userRole, autoOpenProgramReadmeToken, initialData, initialSection);

  return (
    <section className="underwater-panel relative overflow-hidden rounded-2xl">
      <div className="relative min-h-0 min-w-0 w-full">

        <section className="glass-card hourlogger-surface relative z-[1] w-full min-w-0 overflow-hidden rounded-2xl">
          <div className="flex min-h-[min(70vh,560px)] flex-col md:flex-row">
            <SettingsNav
              showStandaloneActions={showStandaloneActions}
              navFilter={s.navFilter}
              setNavFilter={s.setNavFilter}
              items={s.filteredNavItems}
              activeSection={s.activeSection}
              onSelect={s.setActiveSection}
            />

            <div className="min-h-[280px] min-w-0 flex-1 overflow-y-auto border-t border-glass/5 bg-overlay/20 p-4 md:border-t-0 md:p-6">
              <div className="mx-auto max-w-2xl">
                <h2 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">
                  {SETTINGS_NAV.find((n) => n.id === s.activeSection)?.label ?? "Settings"}
                </h2>

                {!s.isSalesOnly && s.activeSection === "gmail" ? (
                  <GmailSection status={s.gmailStatus} onDisconnect={() => void s.handleDisconnectGmail()} />
                ) : null}

                {!s.isSalesOnly && s.activeSection === "mail_signature" ? (
                  <MailSignatureSection
                    preset={s.mailSigPreset}
                    custom={s.mailSigCustom}
                    saving={s.mailSigSaving}
                    onPresetChange={s.setMailSigPreset}
                    onCustomChange={s.setMailSigCustom}
                    onSave={() => void s.handleSaveMailSignature()}
                  />
                ) : null}

                {!s.isSalesOnly && s.activeSection === "travel_mapping" ? (
                  <TravelMappingSection
                    mapping={s.travelMapping}
                    setMapping={s.setTravelMapping}
                    saving={s.mappingSaving}
                    onSave={() => void s.handleSaveTravelMapping()}
                    onReset={() => void s.handleResetTravelMapping()}
                  />
                ) : null}

                {s.activeSection === "time_data" ? (
                  <TimeDataSection
                    importing={s.importing}
                    exporting={s.exporting}
                    onImportFile={(file) => void s.handleImportFile(file)}
                    onExport={() => void s.handleExportData()}
                  />
                ) : null}

                {s.activeSection === "appearance" ? <AppearanceSection /> : null}

                {s.activeSection === "interface_sounds" ? <InterfaceSoundsSection /> : null}

                {s.activeSection === "security" ? (
                  <SecuritySection
                    confirmText={s.deleteConfirmText}
                    setConfirmText={s.setDeleteConfirmText}
                    deleting={s.deletingAccount}
                    onDelete={() => void s.handleDeleteAccount()}
                  />
                ) : null}

                {s.activeSection === "readme" ? (
                  <ReadmeSection isSalesOnly={s.isSalesOnly} openReadme={s.openReadme} onToggle={s.toggleReadme} />
                ) : null}

                {s.message ? <p className="mt-8 text-sm text-positive">{s.message}</p> : null}
                {s.error ? <p className="mt-2 text-sm text-danger">{s.error}</p> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
