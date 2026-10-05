/**
 * The dashboard's module list, in its own module because BOTH sides need it:
 * `dashboard-shell.tsx` ("use client") to render and switch modules, and
 * `app/dashboard/page.tsx` (server) to validate `?module=` before seeding the
 * shell with it.
 *
 * It cannot live in the shell. A server component that imports a value from a
 * "use client" file does not get the value — it gets a client reference, and
 * touching a property on it (`MODULE_KEYS.includes(...)`) throws at request
 * time, which is exactly how this landed as "The workspace didn't load".
 */

export type ModuleKey = "mail" | "time" | "fleet" | "settings" | "admin";

export const MODULE_KEYS: ModuleKey[] = ["mail", "time", "fleet", "settings", "admin"];

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as string[]).includes(value);
}
