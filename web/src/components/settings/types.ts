import { canUseModule, type GatedModule } from "@/lib/role-access";
import type { UserRole } from "@/lib/user-role";

export type SettingsSectionId =
  | "gmail"
  | "travel_mapping"
  | "time_data"
  | "appearance"
  | "interface_sounds"
  | "notifications"
  | "security"
  | "readme";

export const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  "gmail",
  "travel_mapping",
  "time_data",
  "appearance",
  "interface_sounds",
  "notifications",
  "security",
  "readme",
];

/** `needs`: the module a section belongs to; roles without it never see it (lib/role-access.ts). */
export const SETTINGS_NAV: { id: SettingsSectionId; label: string; needs?: GatedModule }[] = [
  { id: "gmail", label: "Gmail", needs: "mail" },
  { id: "travel_mapping", label: "Travel mapping", needs: "travel" },
  { id: "time_data", label: "Time data", needs: "travel" },
  { id: "appearance", label: "Appearance" },
  { id: "interface_sounds", label: "Interface sounds" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Account & security" },
  { id: "readme", label: "Help & README" },
];

/** Which of the role-gated modules this person has, for Settings to show only theirs. */
export type SettingsAccess = Record<GatedModule, boolean>;

export function settingsAccessFor(role: UserRole | null, isAdmin: boolean): SettingsAccess {
  return {
    mail: canUseModule(role, isAdmin, "mail"),
    time: canUseModule(role, isAdmin, "time"),
    fleet: canUseModule(role, isAdmin, "fleet"),
    travel: canUseModule(role, isAdmin, "travel"),
  };
}

export function visibleSettingsNav(access: SettingsAccess) {
  return SETTINGS_NAV.filter((item) => !item.needs || access[item.needs]);
}

export function filterSettingsNav(access: SettingsAccess, navFilter: string) {
  const visible = visibleSettingsNav(access);
  const q = navFilter.trim().toLowerCase();
  return q === "" ? visible : visible.filter((item) => item.label.toLowerCase().includes(q));
}

/** SSR-prefetched values matching the two fetches the panel fires on mount.
 *  Shape mirrors `InitialSettingsData` from `@/lib/settings-queries` (kept
 *  structural so this client module doesn't import the server-only file). */
export type InitialSettings = {
  gmail: { connected: boolean; gmail_email: string | null };
  travelMapping: TravelMapping;
};

export type SettingsPanelProps = {
  email: string;
  showStandaloneActions?: boolean;
  autoOpenProgramReadmeToken?: number;
  userRole?: UserRole;
  isAdmin?: boolean;
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
