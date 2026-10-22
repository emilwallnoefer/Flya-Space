"use client";
import { SettingsPanel } from "@/components/settings-panel";
import type { SettingsSectionId } from "@/components/settings/types";
import type { UserRole } from "@/lib/user-role";

type SettingsShellProps = {
  email: string;
  userRole: UserRole | null;
  isAdmin: boolean;
  /** Section to open on load, parsed server-side from `?section=`. */
  initialSection?: SettingsSectionId | null;
};

export function SettingsShell({ email, userRole, isAdmin, initialSection = null }: SettingsShellProps) {
  return (
    <main id="main-content" className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 aurora-bg" />
      <section className="page-shell max-w-5xl">
        <SettingsPanel
          email={email}
          showStandaloneActions
          userRole={userRole ?? "eu_pilot"}
          isAdmin={isAdmin}
          initialSection={initialSection}
        />
      </section>
    </main>
  );
}
