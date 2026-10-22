/**
 * Which dashboard modules each role may open — the one place that decides it,
 * shared by the desktop shell, the phone shell and the server (which uses
 * `canSeeGoogleEmbeds` to decide whether to build the embed URLs at all).
 *
 * - Sales: Fleet and the Google sheets/form. No Time Tracker, no Mail.
 * - EU Pilot: Mail, Time Tracker, Fleet and the Google sheets/form.
 * - US Pilot: Mail and Time Tracker only.
 * - HR: the read-only team time view (the "admin" module, which for a
 *   non-admin shows only its Time section), opened from a home card.
 * - Admins: everything, whatever role they hold.
 *
 * Settings is everyone's. The same rules are enforced on the server: every
 * Mail, Time Tracker and Fleet route asks `forbidWithoutModule()`
 * (lib/app-access.ts), which reads `canUseModule` below.
 */

import type { ModuleKey } from "@/lib/dashboard-modules";
import type { UserRole } from "@/lib/user-role";

/** Which Google embeds have an id configured (an unset id hides that card). */
export type ConfiguredEmbeds = { planning: boolean; fleetsheet: boolean; roaddays: boolean };

export function canSeeGoogleEmbeds(role: UserRole | null, isAdmin: boolean): boolean {
  return isAdmin || role === "eu_pilot" || role === "sales";
}

/** The modules whose API routes check the role (the sheets have their own rule above). */
export type GatedModule = "mail" | "time" | "fleet";

export const GATED_MODULE_LABELS: Record<GatedModule, string> = {
  mail: "the Mail Composer",
  time: "the Time Tracker",
  fleet: "Fleet",
};

export function canUseModule(role: UserRole | null, isAdmin: boolean, module: GatedModule): boolean {
  if (isAdmin || role === "eu_pilot") return true;
  if (module === "fleet") return role === "sales";
  return role === "us_pilot";
}

export function availableModulesFor(role: UserRole | null, isAdmin: boolean, embeds: ConfiguredEmbeds): ModuleKey[] {
  const modules: ModuleKey[] = [];
  if (canUseModule(role, isAdmin, "mail")) modules.push("mail");
  if (canUseModule(role, isAdmin, "time")) modules.push("time");
  if (canUseModule(role, isAdmin, "fleet")) modules.push("fleet");
  modules.push("settings");
  if (canSeeGoogleEmbeds(role, isAdmin)) {
    if (embeds.planning) modules.push("planning");
    if (embeds.fleetsheet) modules.push("fleetsheet");
    if (embeds.roaddays) modules.push("roaddays");
  }
  if (isAdmin || role === "hr") modules.push("admin");
  return modules;
}
