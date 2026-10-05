/**
 * Mission planning: the "Mission planning" tab of the planning spreadsheet,
 * embedded as Google's own editor in an iframe.
 *
 * The sheet never passes through our server: it loads from docs.google.com in
 * the user's browser, with their own Google session. Who may EDIT is decided by
 * the sheet's Google sharing, and every edit lands in its version history under
 * that person's name. What this module decides is only who sees the embed at
 * all — pilots and admins, not sales or HR — and the page builds the URL only
 * for them, so other roles never receive it.
 *
 * Signed out of Google, the frame redirects to Google's sign-in page, which
 * refuses to be framed. Safari and Firefox may also withhold the Google session
 * from a third-party frame. Both cases are handled by the panel's
 * "Sign in to Google" and "Open in Google Sheets" buttons, which use a new tab.
 *
 * `rm=embedded` keeps the menus and format toolbar; `rm=minimal` drops them.
 */

import type { UserRole } from "@/lib/user-role";

export function canSeeMissionPlanning(role: UserRole | null, isAdmin: boolean): boolean {
  return isAdmin || role === "eu_pilot" || role === "us_pilot";
}

export type MissionPlanningUrls = {
  /** What the iframe loads. */
  embed: string;
  /** The same tab, full Google Sheets UI, for a new tab. */
  open: string;
  /** Google sign-in that returns to the sheet. */
  signIn: string;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

/** `null` when the spreadsheet id is missing or malformed. */
export function missionPlanningUrls(spreadsheetId: string | undefined, gid: string | undefined): MissionPlanningUrls | null {
  const id = spreadsheetId?.trim() ?? "";
  if (!ID_PATTERN.test(id)) return null;
  const tab = gid?.trim() && /^\d+$/.test(gid.trim()) ? `#gid=${gid.trim()}` : "";
  const base = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const open = `${base}${tab}`;
  return {
    embed: `${base}?rm=embedded${tab}`,
    open,
    signIn: `https://accounts.google.com/ServiceLogin?service=wise&continue=${encodeURIComponent(open)}`,
  };
}
