import "server-only";

import { sheets as sheetsApi } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/gmail";
import { fieldStatsSourceToken } from "@/lib/field-stats-sheet";
import { todayInZurich } from "@/lib/fleet-queries";
import type { EmbedSheet } from "@/lib/google-embeds";
import { findTodayColumnCell, findTodayRowCell } from "@/lib/sheet-today";

/**
 * Today's cell in an embedded sheet, so the frame opens scrolled to it. The
 * frame is cross-origin and cannot be scrolled from our page; the only lever is
 * the `range=` in the URL Google loads, so the server reads the tab's calendar
 * headers first and hands back the cell.
 *
 * Read with the same admin Google connection as Field stats. Only the header
 * cells are read (columns A:C of Mission planning, the top rows of the fleet
 * sheet), and only a cell address leaves the server. Anything missing — no
 * connection, no access to the sheet, no column for today — returns null and
 * the sheet simply opens at its top.
 */

const SOURCES: Record<EmbedSheet, { id: string | undefined; gid: string | undefined; layout: "rows" | "columns" }> = {
  planning: {
    id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    gid: process.env.GOOGLE_SHEETS_GID,
    layout: "rows",
  },
  fleet: { id: process.env.FLEET_SHEET_ID, gid: process.env.FLEET_SHEET_GID, layout: "columns" },
};

/** A found cell holds for the day; the date is part of the key. */
const cache = new Map<string, string | null>();
/** A failure is retried after a minute rather than on every open. */
const failures = new Map<string, number>();
const FAILURE_TTL_MS = 60 * 1000;

async function read(sheet: EmbedSheet, today: string): Promise<string | null> {
  const source = SOURCES[sheet];
  const spreadsheetId = source.id?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!spreadsheetId || !redirectUri) return null;
  const refreshToken = await fieldStatsSourceToken();
  if (!refreshToken) return null;

  const oauthClient = getOAuthClient(redirectUri);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  const sheets = sheetsApi({ version: "v4", auth: oauthClient });

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  const tabs = meta.data.sheets ?? [];
  const gid = Number.parseInt(source.gid ?? "", 10);
  // No gid in the URL opens the first tab, so that is the one to search.
  const tab = (Number.isFinite(gid) ? tabs.find((s) => s.properties?.sheetId === gid) : tabs[0])?.properties?.title;
  if (!tab) return null;
  const quoted = `'${tab.replace(/'/g, "''")}'`;

  const range = source.layout === "rows" ? `${quoted}!A1:C` : `${quoted}!1:6`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = (response.data.values ?? []) as unknown[][];
  const cell = source.layout === "rows" ? findTodayRowCell(rows, today) : findTodayColumnCell(rows, today);
  if (!cell) console.warn("[google-embed-today] no cell for today", sheet, today, `tab "${tab}"`, `${rows.length} rows`);
  return cell;
}

export async function todayCellFor(sheet: EmbedSheet, now: Date = new Date()): Promise<string | null> {
  const today = todayInZurich(now);
  const key = `${sheet}:${today}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const failedAt = failures.get(sheet);
  if (failedAt && now.getTime() - failedAt < FAILURE_TTL_MS) return null;
  try {
    const cell = await read(sheet, today);
    // Yesterday's keys are dead weight once the date turns.
    for (const old of cache.keys()) if (old.startsWith(`${sheet}:`)) cache.delete(old);
    cache.set(key, cell);
    failures.delete(sheet);
    return cell;
  } catch (error) {
    console.warn("[google-embed-today] sheet read failed", sheet, (error as Error)?.message);
    failures.set(sheet, now.getTime());
    return null;
  }
}
