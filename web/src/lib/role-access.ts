/**
 * Which dashboard modules each role may open — the one place that decides it,
 * shared by the desktop shell, the phone shell and the server (which uses
 * `canSeeGoogleEmbed` to decide whether to build each embed URL at all).
 *
 * - Sales: Fleet, Mission planning and Fleet management. No Road Days, no
 *   Time Tracker, no Mail.
 * - EU Pilot: Mail, Time Tracker, Fleet and all three Google cards.
 * - US Pilot: the Mail Composer only — no Time Tracker, no travel sheet
 *   (owner decision 2026-10-22).
 * - HR: the read-only team time view (the "admin" module, which for a
 *   non-admin shows only its Time section), opened from a home card.
 * - Admins: everything, whatever role they hold.
 *
 * On top of the role, an admin can switch a module on for one person
 * (Admin → Users & roles): `app_metadata.module_grants`, service-role
 * writable only, like the role itself. Only the Time Tracker is grantable so
 * far, and a grant does nothing for an account without a role.
 *
 * Settings is everyone's. The same rules are enforced on the server: every
 * Mail, Time Tracker, Fleet and travel-sheet route asks `forbidWithoutModule()`
 * (lib/app-access.ts), which reads `canUseModule` below.
 */

import type { ModuleKey } from "@/lib/dashboard-modules";
import type { UserRole } from "@/lib/user-role";

export type EmbedKey = "planning" | "fleetsheet" | "roaddays";

/** Which Google embeds have an id configured (an unset id hides that card). */
export type ConfiguredEmbeds = Record<EmbedKey, boolean>;

export function canSeeGoogleEmbed(role: UserRole | null, isAdmin: boolean, embed: EmbedKey): boolean {
  if (isAdmin || role === "eu_pilot") return true;
  return role === "sales" && embed !== "roaddays";
}

/** True when the role sees at least one of the Google embeds. */
export function canSeeGoogleEmbeds(role: UserRole | null, isAdmin: boolean): boolean {
  return (["planning", "fleetsheet", "roaddays"] as const).some((embed) => canSeeGoogleEmbed(role, isAdmin, embed));
}

/**
 * What the API routes check the role for (the Google embeds have their own
 * rule above). `travel` is the travel sheet behind the Time Tracker: Travel
 * mapping, Time data and the travel lookup on a week.
 */
export type GatedModule = "mail" | "time" | "fleet" | "travel";

export const GATED_MODULE_LABELS: Record<GatedModule, string> = {
  mail: "the Mail Composer",
  time: "the Time Tracker",
  fleet: "Fleet",
  travel: "the travel sheet",
};

/** Modules an admin can switch on for one person beyond their role. */
export type ModuleGrant = "time";
export const GRANTABLE_MODULES: readonly ModuleGrant[] = ["time"];

/**
 * The grants on an account, from `app_metadata.module_grants` ONLY — never
 * user_metadata, which the user can rewrite (SECURITY.md T0.1). Unknown values
 * are dropped.
 */
export function readModuleGrants(appMetadata: unknown): ModuleGrant[] {
  if (!appMetadata || typeof appMetadata !== "object" || Array.isArray(appMetadata)) return [];
  const raw = (appMetadata as Record<string, unknown>).module_grants;
  if (!Array.isArray(raw)) return [];
  return GRANTABLE_MODULES.filter((module) => raw.includes(module));
}

/**
 * The grant list after switching one module on or off — for the admin route
 * to write back into app_metadata. Keeps the order of GRANTABLE_MODULES and
 * drops unknown values.
 */
export function withModuleGrant(appMetadata: unknown, module: ModuleGrant, on: boolean): ModuleGrant[] {
  const current = readModuleGrants(appMetadata);
  return GRANTABLE_MODULES.filter((m) => (m === module ? on : current.includes(m)));
}

export function canUseModule(
  role: UserRole | null,
  isAdmin: boolean,
  module: GatedModule,
  grants: readonly ModuleGrant[] = [],
): boolean {
  if (isAdmin || role === "eu_pilot") return true;
  if (role !== null && (grants as readonly string[]).includes(module)) return true;
  if (module === "fleet") return role === "sales";
  if (module === "mail") return role === "us_pilot";
  return false;
}

export function availableModulesFor(
  role: UserRole | null,
  isAdmin: boolean,
  embeds: ConfiguredEmbeds,
  grants: readonly ModuleGrant[] = [],
): ModuleKey[] {
  const modules: ModuleKey[] = [];
  if (canUseModule(role, isAdmin, "mail", grants)) modules.push("mail");
  if (canUseModule(role, isAdmin, "time", grants)) modules.push("time");
  if (canUseModule(role, isAdmin, "fleet", grants)) modules.push("fleet");
  modules.push("settings");
  for (const embed of ["planning", "fleetsheet", "roaddays"] as const) {
    if (embeds[embed] && canSeeGoogleEmbed(role, isAdmin, embed)) modules.push(embed);
  }
  if (isAdmin || role === "hr") modules.push("admin");
  return modules;
}
