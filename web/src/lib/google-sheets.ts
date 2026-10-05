import "server-only";

import { sheets as sheetsApi } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/gmail";

export type TravelInfo = {
  client: string;
  location: string;
  responsible: string;
};

export type TravelSheetColumnMapping = {
  monthYearColumn?: string;
  dayColumn?: string;
  clientColumn?: string;
  locationColumn?: string;
  responsibleColumn?: string;
  range?: string;
  gid?: string;
};

export type TravelFetchErrorReason =
  | "insufficient_scope"
  | "no_sheet_access"
  | "sheet_not_found"
  | "token_expired"
  | "config_missing"
  | "unknown";

/**
 * Maps a raw Google API / config error from `fetchTravelByDate` to a reason
 * code plus an actionable hint. These are the failure modes that make travel
 * data work for one user but not another (per-user OAuth token, per-account
 * spreadsheet sharing), so keep the hints specific enough to act on.
 */
export function classifyTravelFetchError(error: unknown): {
  reason: TravelFetchErrorReason;
  hint: string;
} {
  const err = error as { message?: string; response?: { status?: number }; status?: number } | null;
  const message = err?.message ?? "";
  const status = err?.response?.status ?? err?.status;

  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return {
      reason: "insufficient_scope",
      hint:
        "The Google connection was made without spreadsheet access (likely connected before Sheets support was added, or the Sheets checkbox was unticked on the consent screen). Disconnect and reconnect Gmail in Settings, and approve spreadsheet access.",
    };
  }
  if (/invalid_grant|invalid_rapt|token has been expired or revoked/i.test(message)) {
    return {
      reason: "token_expired",
      hint: "The Google connection expired or was revoked. Disconnect and reconnect Gmail in Settings.",
    };
  }
  if (status === 403 || /caller does not have permission|PERMISSION_DENIED/i.test(message)) {
    return {
      reason: "no_sheet_access",
      hint:
        "The connected Google account cannot open the travel spreadsheet. Share the spreadsheet with that account (viewer is enough), or reconnect with an account that has access.",
    };
  }
  if (status === 404 || /requested entity was not found/i.test(message)) {
    return {
      reason: "sheet_not_found",
      hint: "The configured spreadsheet ID was not found. Check GOOGLE_SHEETS_SPREADSHEET_ID and any custom range/tab (gid) in the personal travel mapping.",
    };
  }
  if (/missing required env var|invalid sheet column letter/i.test(message)) {
    return {
      reason: "config_missing",
      hint: "Server-side travel-sheet configuration is missing or invalid — check the GOOGLE_SHEETS_* environment variables.",
    };
  }
  return {
    reason: "unknown",
    hint: "Unrecognized error — check the server logs for the full Google API response.",
  };
}

const DEFAULT_MONTH_YEAR_COLUMN = "A";
const DEFAULT_DAY_COLUMN = "C";
const DEFAULT_CLIENT_COLUMN = "P";
const DEFAULT_LOCATION_COLUMN = "Q";
const DEFAULT_RESPONSIBLE_COLUMN = "R";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function columnLetterToIndex(letter: string) {
  const normalized = letter.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) return -1;
  let result = 0;
  for (const ch of normalized) {
    result = result * 26 + (ch.charCodeAt(0) - 64);
  }
  return result - 1;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  mai: 5,
  juni: 6,
  juli: 7,
  oktober: 10,
  dezember: 12,
};

/**
 * Parses a cell that holds a complete date on its own — ISO `2026-07-15` or
 * unambiguous European `15.07.2026`. Used for "flat" travel tabs (one date
 * column per row, e.g. the "Sync View" tab) as an alternative to the legacy
 * month/year + day column pair. Slash formats are deliberately not supported
 * (M/D vs D/M is ambiguous).
 */
export function parseFullDate(value: string) {
  const text = value.trim();
  let year: number, month: number, day: number;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    year = Number.parseInt(match[1], 10);
    month = Number.parseInt(match[2], 10);
    day = Number.parseInt(match[3], 10);
  } else {
    match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!match) return null;
    day = Number.parseInt(match[1], 10);
    month = Number.parseInt(match[2], 10);
    year = Number.parseInt(match[3], 10);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateFromMonthYearDay(monthYearRaw: string, dayRaw: string) {
  const monthYear = monthYearRaw.trim().replace(/\s+/g, " ");
  const day = Number.parseInt(dayRaw.trim(), 10);
  if (!monthYear || !Number.isFinite(day) || day < 1 || day > 31) return null;

  const match = monthYear.match(/^([\p{L}.-]+)\s+(\d{4})$/u);
  if (!match) return null;
  const monthToken = match[1].toLowerCase();
  const year = Number.parseInt(match[2], 10);
  const month = MONTHS[monthToken];
  if (!month || !Number.isFinite(year)) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function cleanCell(value: unknown) {
  return String(value ?? "").trim();
}

function resolveColumnWithOverride(name: string, fallback: string, override?: string) {
  const source = (override || process.env[name] || fallback).trim().toUpperCase();
  const index = columnLetterToIndex(source);
  if (index < 0) throw new Error(`Invalid sheet column letter in ${name}: ${source}`);
  return { letter: source, index };
}

export type TravelEffectiveMapping = {
  monthYearColumn: string;
  dayColumn: string;
  clientColumn: string;
  locationColumn: string;
  responsibleColumn: string;
  /** The exact range sent to the Sheets API, tab prefix included. */
  range: string;
};

export type TravelFetchResult = {
  /** Travel info per date — only dates whose row had actual travel content. */
  byDate: Record<string, TravelInfo>;
  /** Rows whose month/year + day cells parsed to a date. */
  parsedDates: number;
  /**
   * Parsed dates whose client/location/responsible cells were all empty.
   * A high count with an empty `byDate` means the date columns line up but
   * the travel columns (or the fetched range) don't match the sheet layout.
   */
  blankDates: number;
  /** The columns/range actually used after personal-mapping and env overrides. */
  effective: TravelEffectiveMapping;
};

export async function fetchTravelByDate(
  refreshToken: string,
  mapping?: TravelSheetColumnMapping,
): Promise<TravelFetchResult> {
  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const baseRange = mapping?.range || process.env.GOOGLE_SHEETS_RANGE || "A:R";
  const gid = mapping?.gid || process.env.GOOGLE_SHEETS_GID;

  const monthYearCol = resolveColumnWithOverride(
    "GOOGLE_SHEETS_DATE_MONTH_YEAR_COLUMN",
    DEFAULT_MONTH_YEAR_COLUMN,
    mapping?.monthYearColumn,
  );
  const dayCol = resolveColumnWithOverride("GOOGLE_SHEETS_DATE_DAY_COLUMN", DEFAULT_DAY_COLUMN, mapping?.dayColumn);
  const clientCol = resolveColumnWithOverride("GOOGLE_SHEETS_COL_CLIENT", DEFAULT_CLIENT_COLUMN, mapping?.clientColumn);
  const locationCol = resolveColumnWithOverride(
    "GOOGLE_SHEETS_COL_LOCATION",
    DEFAULT_LOCATION_COLUMN,
    mapping?.locationColumn,
  );
  const responsibleCol = resolveColumnWithOverride(
    "GOOGLE_SHEETS_COL_RESPONSIBLE",
    DEFAULT_RESPONSIBLE_COLUMN,
    mapping?.responsibleColumn,
  );

  const effective: TravelEffectiveMapping = {
    monthYearColumn: monthYearCol.letter,
    dayColumn: dayCol.letter,
    clientColumn: clientCol.letter,
    locationColumn: locationCol.letter,
    responsibleColumn: responsibleCol.letter,
    range: baseRange,
  };

  if (!refreshToken) return { byDate: {}, parsedDates: 0, blankDates: 0, effective };

  const redirectUri = requiredEnv("GOOGLE_OAUTH_REDIRECT_URI");
  const oauthClient = getOAuthClient(redirectUri);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  const sheets = sheetsApi({ version: "v4", auth: oauthClient });
  let range = baseRange;
  if (!range.includes("!") && gid) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))",
    });
    const targetSheetId = Number.parseInt(gid, 10);
    const tabTitle =
      meta.data.sheets?.find((sheet) => sheet.properties?.sheetId === targetSheetId)?.properties?.title ?? "";
    if (tabTitle) {
      range = `'${tabTitle.replace(/'/g, "''")}'!${baseRange}`;
    }
  }
  effective.range = range;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values ?? [];
  const result: Record<string, TravelInfo> = {};
  let parsedDates = 0;
  let blankDates = 0;

  let activeMonthYear = "";
  for (const row of rows) {
    const monthYearCandidate = cleanCell(row[monthYearCol.index]);
    // Flat layout: the "month/year" column holds a complete date per row.
    // Falls back to the legacy layout (sparse "July 2026" in the month/year
    // column, carried forward, + a day-number column) when it doesn't.
    const fullDateKey = parseFullDate(monthYearCandidate);
    if (!fullDateKey && monthYearCandidate) activeMonthYear = monthYearCandidate;
    const day = cleanCell(row[dayCol.index]);
    const dateKey = fullDateKey ?? parseDateFromMonthYearDay(activeMonthYear, day);
    if (!dateKey) continue;
    parsedDates += 1;

    const info: TravelInfo = {
      client: cleanCell(row[clientCol.index]),
      location: cleanCell(row[locationCol.index]),
      responsible: cleanCell(row[responsibleCol.index]),
    };
    // Sheets often carry a row for every calendar day with the travel columns
    // left blank on non-travel days. Storing those as entries makes the UI
    // render an empty "found" card and hides the diagnostics, so skip them.
    if (!info.client && !info.location && !info.responsible) {
      blankDates += 1;
      continue;
    }

    result[dateKey] = info;
  }

  return { byDate: result, parsedDates, blankDates, effective };
}
