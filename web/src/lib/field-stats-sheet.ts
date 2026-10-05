import "server-only";

import { sheets as sheetsApi } from "@googleapis/sheets";
import { getOAuthClient } from "@/lib/gmail";
import { readGmailRefreshToken } from "@/lib/gmail-tokens";
import { classifyTravelFetchError, type TravelFetchErrorReason } from "@/lib/google-sheets";
import { computeFieldStats, type FieldStats } from "@/lib/field-stats";
import { todayInZurich } from "@/lib/fleet-queries";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server side of Field stats: reads the "Mission planning" tab with one admin's
 * Google connection (chosen in Admin → Field stats) and caches the computed
 * stats for a few minutes. The tab is the same spreadsheet the Time Tracker
 * reads (`GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_SHEETS_GID`).
 */

export type FieldStatsSettings = {
  token_user_id: string | null;
  sales_regions: Record<string, string>;
  updated_at: string | null;
  updated_by: string | null;
};

const EMPTY_SETTINGS: FieldStatsSettings = {
  token_user_id: null,
  sales_regions: {},
  updated_at: null,
  updated_by: null,
};

function asRegionMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [name, region] of Object.entries(value as Record<string, unknown>)) {
    if (typeof region === "string" && name.trim() && region.trim()) out[name.trim()] = region.trim();
  }
  return out;
}

/** The settings row, or empty settings when the migration is not applied yet. */
export async function readFieldStatsSettings(): Promise<FieldStatsSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("field_stats_settings")
    .select("token_user_id, sales_regions, updated_at, updated_by")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn("[field-stats] settings read failed", error.message);
    return EMPTY_SETTINGS;
  }
  return {
    token_user_id: (data.token_user_id as string | null) ?? null,
    sales_regions: asRegionMap(data.sales_regions),
    updated_at: (data.updated_at as string | null) ?? null,
    updated_by: (data.updated_by as string | null) ?? null,
  };
}

export async function writeFieldStatsSettings(
  patch: { token_user_id?: string | null; sales_regions?: Record<string, string> },
  actorEmail: string,
): Promise<FieldStatsSettings> {
  const current = await readFieldStatsSettings();
  const admin = createAdminClient();
  const row = {
    id: true,
    token_user_id: patch.token_user_id !== undefined ? patch.token_user_id : current.token_user_id,
    sales_regions: patch.sales_regions !== undefined ? asRegionMap(patch.sales_regions) : current.sales_regions,
    updated_at: new Date().toISOString(),
    updated_by: actorEmail,
  };
  const { error } = await admin.from("field_stats_settings").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
  invalidateFieldStatsCache();
  return row;
}

export type FieldStatsErrorReason = "not_configured" | "token_missing" | TravelFetchErrorReason;

export type FieldStatsResult =
  | { ok: true; stats: FieldStats; fetchedAt: string; stale: boolean }
  | { ok: false; reason: FieldStatsErrorReason; hint: string };

/** How long one read of the sheet is served before the next request refetches it. */
const CACHE_TTL_MS = 10 * 60 * 1000;

type Snapshot = { stats: FieldStats; fetchedAt: number };

// Per instance. Fluid Compute reuses instances, so most requests hit this; a cold
// instance just pays one sheet read.
let lastGood: Snapshot | null = null;
let inFlight: Promise<FieldStatsResult> | null = null;

export function invalidateFieldStatsCache() {
  lastGood = null;
}

async function readTab(refreshToken: string) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Missing required env var: GOOGLE_SHEETS_SPREADSHEET_ID");
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!redirectUri) throw new Error("Missing required env var: GOOGLE_OAUTH_REDIRECT_URI");

  const oauthClient = getOAuthClient(redirectUri);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  const sheets = sheetsApi({ version: "v4", auth: oauthClient });

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  const gid = Number.parseInt(process.env.GOOGLE_SHEETS_GID ?? "", 10);
  const tabs = meta.data.sheets ?? [];
  const tab =
    tabs.find((s) => s.properties?.sheetId === gid)?.properties?.title ??
    tabs.find((s) => s.properties?.title === "Mission planning")?.properties?.title;
  if (!tab) throw new Error("Requested entity was not found: Mission planning tab");
  const quoted = `'${tab.replace(/'/g, "''")}'`;

  // The whole tab (~3.5k rows since 2018) in one call; computeFieldStats skips
  // everything before 2026. Reading from row 2 keeps the month/year carry-down
  // correct without depending on where 2026 starts.
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`${quoted}!A1:BZ1`, `${quoted}!A2:BZ`],
  });
  const [headerRange, bodyRange] = response.data.valueRanges ?? [];
  return {
    header: (headerRange?.values?.[0] ?? []) as unknown[],
    rows: (bodyRange?.values ?? []) as unknown[][],
  };
}

async function refresh(): Promise<FieldStatsResult> {
  const settings = await readFieldStatsSettings();
  if (!settings.token_user_id) {
    return {
      ok: false,
      reason: "not_configured",
      hint: "An admin needs to connect the planning sheet under Admin → Field stats.",
    };
  }
  const refreshToken = await readGmailRefreshToken(settings.token_user_id);
  if (!refreshToken) {
    return {
      ok: false,
      reason: "token_missing",
      hint: "The Google connection used for Field stats was disconnected. An admin needs to reconnect it under Admin → Field stats.",
    };
  }

  try {
    const { header, rows } = await readTab(refreshToken);
    const now = new Date();
    const stats = computeFieldStats({
      header,
      rows,
      today: todayInZurich(now),
      salesRegions: settings.sales_regions,
    });
    lastGood = { stats, fetchedAt: now.getTime() };
    return { ok: true, stats, fetchedAt: now.toISOString(), stale: false };
  } catch (error) {
    const classified = classifyTravelFetchError(error);
    console.error("[field-stats] sheet read failed", classified.reason, (error as Error)?.message);
    if (lastGood) {
      // Keep showing the last good numbers rather than an empty page.
      return { ok: true, stats: lastGood.stats, fetchedAt: new Date(lastGood.fetchedAt).toISOString(), stale: true };
    }
    return { ok: false, ...classified };
  }
}

export async function getFieldStats(): Promise<FieldStatsResult> {
  if (lastGood && Date.now() - lastGood.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, stats: lastGood.stats, fetchedAt: new Date(lastGood.fetchedAt).toISOString(), stale: false };
  }
  inFlight ??= refresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
