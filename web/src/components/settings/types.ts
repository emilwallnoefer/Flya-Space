import type { UserRole } from "@/lib/user-role";

export type SettingsSectionId =
  | "gmail"
  | "travel_mapping"
  | "mail_signature"
  | "time_data"
  | "appearance"
  | "interface_sounds"
  | "notifications"
  | "security"
  | "readme";

export const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  "gmail",
  "travel_mapping",
  "mail_signature",
  "time_data",
  "appearance",
  "interface_sounds",
  "notifications",
  "security",
  "readme",
];

export const SETTINGS_NAV: { id: SettingsSectionId; label: string; pilotOnly?: boolean }[] = [
  { id: "gmail", label: "Gmail", pilotOnly: true },
  { id: "travel_mapping", label: "Travel mapping", pilotOnly: true },
  { id: "mail_signature", label: "Mail signature", pilotOnly: true },
  { id: "time_data", label: "Time data" },
  { id: "appearance", label: "Appearance" },
  { id: "interface_sounds", label: "Interface sounds" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Account & security" },
  { id: "readme", label: "Help & README" },
];

export function filterSettingsNav(isSalesOnly: boolean, navFilter: string) {
  const visible = SETTINGS_NAV.filter((item) => !item.pilotOnly || !isSalesOnly);
  const q = navFilter.trim().toLowerCase();
  return q === "" ? visible : visible.filter((item) => item.label.toLowerCase().includes(q));
}

/** SSR-prefetched values matching the three fetches the panel fires on mount.
 *  Shape mirrors `InitialSettingsData` from `@/lib/settings-queries` (kept
 *  structural so this client module doesn't import the server-only file). */
export type InitialSettings = {
  gmail: { connected: boolean; gmail_email: string | null };
  travelMapping: TravelMapping;
  mailSignatureName: string;
};

export type SettingsPanelProps = {
  email: string;
  showStandaloneActions?: boolean;
  autoOpenProgramReadmeToken?: number;
  userRole?: UserRole;
  /** When provided, seeds the panel so it doesn't refetch on mount. */
  initialData?: InitialSettings | null;
  /**
   * Section to open on load. Only the server-rendered standalone `/settings`
   * page passes it (parsed from `?section=`) — inside the dashboard the panel is
   * client-only and reads the URL itself.
   */
  initialSection?: SettingsSectionId | null;
};

export type GmailStatus = { connected: boolean; gmail_email?: string | null };

export type TravelMapping = {
  clientColumn: string;
  locationColumn: string;
  responsibleColumn: string;
};

export type ReadmeKey = "program" | "gmail" | "mapping" | "import";
