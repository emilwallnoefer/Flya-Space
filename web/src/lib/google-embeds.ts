/**
 * Google Sheets and Forms embedded in the app as Google's own UI in an iframe:
 * - "Mission planning": the planning spreadsheet (`GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_SHEETS_GID`)
 * - "Fleet management": a sheet (`FLEET_SHEET_ID` / `FLEET_SHEET_GID`)
 * - "Road Days": a form (`ROAD_DAYS_FORM_ID`, the id after `/forms/d/e/`)
 * The ids live in env, not code, because the repo is public.
 *
 * Nothing passes through our server: the page loads from docs.google.com in
 * the user's browser, with their own Google session. Who may edit a sheet or
 * answer a form is decided by Google's sharing, and every edit or response is
 * recorded under that person's account. What this module decides is only who
 * sees the embeds at all — pilots and admins, not sales or HR — and the page
 * builds the URLs only for them, so other roles never receive them.
 *
 * Signed out of Google, the frame shows Google's sign-in prompt, and Google's
 * actual sign-in page refuses to be framed. Safari and Firefox may also
 * withhold the Google session from a third-party frame. The panel's
 * "Sign in to Google" and "Open in Google …" buttons cover both, in a new tab.
 *
 * Sheets use `rm=embedded` (keeps menus and the format toolbar; `rm=minimal`
 * drops them). Forms use `embedded=true`. The two calendar sheets open scrolled
 * to today: the panel asks `/api/google-embeds/today` for the cell and adds it
 * as `range=` to the URL (`withRange`), the only way to steer a cross-origin frame.
 */

import type { UserRole } from "@/lib/user-role";

export function canSeeGoogleEmbeds(role: UserRole | null, isAdmin: boolean): boolean {
  return isAdmin || role === "eu_pilot" || role === "us_pilot";
}

/** The calendar sheets whose today cell the server can find (`google-embed-today.ts`). */
export type EmbedSheet = "planning" | "fleet";

export type GoogleEmbed = {
  kind: "sheet" | "form";
  /** Set on a calendar sheet: open it scrolled to today. */
  today?: EmbedSheet;
  /** What the iframe loads. */
  embed: string;
  /** The same page in Google's full UI, for a new tab. */
  open: string;
  /** Google sign-in that returns to the page. */
  signIn: string;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

function signInTo(url: string): string {
  return `https://accounts.google.com/ServiceLogin?service=wise&continue=${encodeURIComponent(url)}`;
}

function cleanId(id: string | undefined): string | null {
  const trimmed = id?.trim() ?? "";
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** `null` when the spreadsheet id is missing or malformed, which hides the card. */
export function sheetEmbed(
  spreadsheetId: string | undefined,
  gid: string | undefined,
  today?: EmbedSheet,
): GoogleEmbed | null {
  const id = cleanId(spreadsheetId);
  if (!id) return null;
  const tab = gid?.trim() && /^\d+$/.test(gid.trim()) ? `#gid=${gid.trim()}` : "";
  const base = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const open = `${base}${tab}`;
  return { kind: "sheet", today, embed: `${base}?rm=embedded${tab}`, open, signIn: signInTo(open) };
}

const CELL_PATTERN = /^[A-Z]{1,3}[1-9]\d{0,6}$/;

/** A sheet URL that opens with `cell` selected and in view; unchanged without a valid cell. */
export function withRange(url: string, cell: string | null | undefined): string {
  if (!cell || !CELL_PATTERN.test(cell)) return url;
  return `${url}${url.includes("#") ? "&" : "#"}range=${cell}`;
}

/**
 * A form by its published id (`/forms/d/e/<id>/viewform`). `null` when the id
 * is missing or malformed, which hides the card.
 */
export function formEmbed(formId: string | undefined): GoogleEmbed | null {
  const id = cleanId(formId);
  if (!id) return null;
  const open = `https://docs.google.com/forms/d/e/${id}/viewform`;
  return { kind: "form", embed: `${open}?embedded=true`, open, signIn: signInTo(open) };
}
