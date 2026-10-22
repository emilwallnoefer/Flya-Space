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
 * Settings is everyone's. This is what the UI offers; it is not a security
 * boundary — the API routes and RLS policies are.
 */

import type { ModuleKey } from "@/lib/dashboard-modules";
import type { UserRole } from "@/lib/user-role";

/** Which Google embeds have an id configured (an unset id hides that card). */
export type ConfiguredEmbeds = { planning: boolean; fleetsheet: boolean; roaddays: boolean };

export function canSeeGoogleEmbeds(role: UserRole | null, isAdmin: boolean): boolean {
  return isAdmin || role === "eu_pilot" || role === "sales";
}

export function availableModulesFor(role: UserRole | null, isAdmin: boolean, embeds: ConfiguredEmbeds): ModuleKey[] {
  const pilot = isAdmin || role === "eu_pilot";
  const modules: ModuleKey[] = [];
  if (pilot || role === "us_pilot") modules.push("mail", "time");
  if (pilot || role === "sales") modules.push("fleet");
  modules.push("settings");
  if (canSeeGoogleEmbeds(role, isAdmin)) {
    if (embeds.planning) modules.push("planning");
    if (embeds.fleetsheet) modules.push("fleetsheet");
    if (embeds.roaddays) modules.push("roaddays");
  }
  if (isAdmin || role === "hr") modules.push("admin");
  return modules;
}
