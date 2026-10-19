import { isModuleKey, type ModuleKey } from "@/lib/dashboard-modules";

/**
 * Which request gets the opening shot, and which module a dashboard reload is
 * asking for. Both are decided from the request URL, which the root layout
 * and the dashboard's loading UI cannot see on their own (a layout gets no
 * searchParams, a loading file gets no props): `src/proxy.ts` forwards the
 * path and query on this request header, and the two read it back.
 *
 * The rule, from the owner (2026-10-19): the "The Flya Space" camera opening
 * belongs to the workspace home (`/dashboard` with no module) and to the
 * login page, where the launch page at "/" hands over. A reload anywhere else
 * — a module open under `?module=`, Settings, Onboarding — shows that view's
 * skeleton and nothing in front of it.
 */
export const REQUEST_URL_HEADER = "x-flya-request-url";

export type RequestUrl = { pathname: string; search: string };

/** `pathname + search` as the proxy wrote it, split back; null when the header is absent. */
export function parseRequestUrl(value: string | null | undefined): RequestUrl | null {
  if (!value || !value.startsWith("/")) return null;
  const q = value.indexOf("?");
  return q === -1 ? { pathname: value, search: "" } : { pathname: value.slice(0, q), search: value.slice(q) };
}

/**
 * The module `?module=` names, or null for the workspace home. Unknown values
 * fall through to the home, exactly as `app/dashboard/page.tsx` treats them.
 * The role is not known here, so a module the role cannot open still reads
 * as that module; the page then lands on the home over a module skeleton,
 * which is the rare bookmark-after-role-change case and harmless.
 */
export function requestedDashboardModule(search: string): ModuleKey | null {
  const raw = new URLSearchParams(search).get("module");
  return isModuleKey(raw) ? raw : null;
}

/**
 * Whether the launch splash is rendered for this request. Without the header
 * (a request the proxy did not see) the answer is yes, which is what every
 * page did before the header existed.
 */
export function showsLaunchSplash(url: RequestUrl | null): boolean {
  if (!url) return true;
  if (url.pathname === "/login") return true;
  if (url.pathname === "/dashboard") return requestedDashboardModule(url.search) === null;
  return false;
}
