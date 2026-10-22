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

export function canUseModule(role: UserRole | null, isAdmin: boolean, module: GatedModule): boolean {
  if (isAdmin || role === "eu_pilot") return true;
  if (module === "fleet") return role === "sales";
  if (module === "mail") return role === "us_pilot";
  return false;
}

export function availableModulesFor(role: UserRole | null, isAdmin: boolean, embeds: ConfiguredEmbeds): ModuleKey[] {
  const modules: ModuleKey[] = [];
  if (canUseModule(role, isAdmin, "mail")) modules.push("mail");
  if (canUseModule(role, isAdmin, "time")) modules.push("time");
  if (canUseModule(role, isAdmin, "fleet")) modules.push("fleet");
  modules.push("settings");
  for (const embed of ["planning", "fleetsheet", "roaddays"] as const) {
    if (embeds[embed] && canSeeGoogleEmbed(role, isAdmin, embed)) modules.push(embed);
  }
  if (isAdmin || role === "hr") modules.push("admin");
  return modules;
}
