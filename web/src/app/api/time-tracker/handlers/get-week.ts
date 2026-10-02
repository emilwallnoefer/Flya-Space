import { NextResponse } from "next/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { createClient } from "@/lib/supabase/server";
import { readGmailConnection } from "@/lib/gmail-tokens";
import {
  classifyTravelFetchError,
  fetchTravelByDate,
  type TravelEffectiveMapping,
  type TravelFetchErrorReason,
} from "@/lib/google-sheets";
import {
  computeCompSourcesForUser,
  fetchCurrentUserWeek,
  getWeekStartDate,
  type CompSource,
} from "@/lib/time-tracker-queries";
import { parseUserTravelMapping, TARGET_MINS } from "./shared";

export async function handleGetWeek(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  // Verify the session locally (no network round-trip). The week RPC enforces
  // auth.uid() internally, so we only need to know that a session is present
  // and to read user_metadata for the optional travel-sheet fetch.
  const claimsRes = await supabase.auth.getClaims();
  const claims = claimsRes.data?.claims ?? null;
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // From the token, not a fresh read: a role change reaches it when the token
  // is reissued, which the session refresher forces on the next page load.
  const held = forbidHeldAccount(claims);
  if (held) return held;

  const url = new URL(request.url);
  const weekStartDate = getWeekStartDate(url.searchParams.get("weekStart") ?? undefined);
  const includeTravel = url.searchParams.get("includeTravel") !== "0";
  if (!weekStartDate) return NextResponse.json({ error: "Invalid weekStart date" }, { status: 400 });

  let week;
  try {
    week = await fetchCurrentUserWeek(supabase, weekStartDate);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to load tracker week" },
      { status: 500 },
    );
  }

  const { week_start: weekStart, week_end: weekEnd, days: weekDays, week_hours_mins: weekHoursMins } = week;
  const overtimeBankMins = week.overtime_bank_mins;
  const includesBank = week.includes_bank;

  let travelByDate: Record<
    string,
    {
      client: string;
      location: string;
      responsible: string;
    }
  > = {};
  let travelDebug: {
    status:
      | "not_attempted"
      | "missing_refresh_token"
      | "missing_mapping"
      | "ok"
      | "ok_empty"
      | "ok_all_blank"
      | "ok_no_week_match"
      | "error";
    message: string;
    fetched_dates: number;
    week_matches: number;
    parsed_dates?: number;
    blank_dates?: number;
    reason?: TravelFetchErrorReason;
    hint?: string;
    effective_mapping?: TravelEffectiveMapping;
    connected_google_email?: string | null;
    used_custom_mapping?: boolean;
  } = {
    status: "not_attempted",
    message: "Not attempted yet.",
    fetched_dates: 0,
    week_matches: 0,
  };
  const weekDateSet = new Set(weekDays.map((day) => day.date));
  if (includeTravel) {
    // Read the mapping from a FRESH user record, not the JWT claims: after
    // saving in Settings (auth.updateUser) the session token keeps the old
    // user_metadata until the next refresh (~1h), which made new mappings
    // appear to not apply. The extra auth round-trip only happens on the
    // slow includeTravel path.
    const freshUserRes = await supabase.auth.getUser();
    const userMetadata = freshUserRes.data?.user?.user_metadata ?? claims.user_metadata ?? null;
    const userTravelMapping = parseUserTravelMapping(userMetadata);
    const usedCustomMapping = Boolean(userTravelMapping);
    let connectedGoogleEmail: string | null = null;
    try {
      // The refresh token lives server-side only (not in the JWT/user_metadata).
      const connection = claims.sub ? await readGmailConnection(String(claims.sub)) : null;
      connectedGoogleEmail = connection?.gmailEmail ?? null;
      if (!connection) {
        travelDebug = {
          status: "missing_refresh_token",
          message: "No Google account is connected for this user.",
          hint: "Connect Gmail/Google in Settings and approve spreadsheet access — travel data is read with each user's own Google account.",
          fetched_dates: 0,
          week_matches: 0,
          connected_google_email: null,
          used_custom_mapping: usedCustomMapping,
        };
      } else if (!userTravelMapping) {
        travelDebug = {
          status: "missing_mapping",
          message: "No personal travel columns are configured for this account.",
          hint: "The travel sheet has one column group per person. Find your name in the header row of the Mission planning tab, then enter your name's column and the two to its right (Status/Location, Reporting to) in Settings → Travel mapping.",
          fetched_dates: 0,
          week_matches: 0,
          connected_google_email: connectedGoogleEmail,
          used_custom_mapping: false,
        };
      } else {
        const fetchResult = await fetchTravelByDate(connection.refreshToken, userTravelMapping);
        travelByDate = fetchResult.byDate;
        const fetchedDates = Object.keys(travelByDate);
        const weekMatches = fetchedDates.filter((date) => weekDateSet.has(date)).length;
        if (fetchResult.parsedDates === 0) {
          travelDebug = {
            status: "ok_empty",
            message: "The spreadsheet was read successfully, but no parseable travel rows were found.",
            hint: "No row in the configured range had a parseable date. Check the server-side range and date columns (GOOGLE_SHEETS_RANGE and the date column envs) against the sheet — dates parse from month/year + day cells or a full-date cell.",
            fetched_dates: 0,
            week_matches: 0,
            parsed_dates: 0,
            blank_dates: 0,
            effective_mapping: fetchResult.effective,
            connected_google_email: connectedGoogleEmail,
            used_custom_mapping: usedCustomMapping,
          };
        } else if (fetchedDates.length === 0) {
          travelDebug = {
            status: "ok_all_blank",
            message: `Dates parsed for ${fetchResult.parsedDates} rows, but the client/location/responsible cells were empty on every one of them.`,
            hint: "The date columns line up, but your travel columns read as empty. Check your three columns in Settings → Travel mapping against the header row of the sheet (and that the server range reaches them).",
            fetched_dates: 0,
            week_matches: 0,
            parsed_dates: fetchResult.parsedDates,
            blank_dates: fetchResult.blankDates,
            effective_mapping: fetchResult.effective,
            connected_google_email: connectedGoogleEmail,
            used_custom_mapping: usedCustomMapping,
          };
        } else if (weekMatches === 0) {
          travelDebug = {
            status: "ok_no_week_match",
            message: "Travel rows loaded, but none with travel content fall in the currently selected week.",
            hint: "The sheet is readable and parseable — this week simply has no travel entries (blank travel cells count as no entry).",
            fetched_dates: fetchedDates.length,
            week_matches: 0,
            parsed_dates: fetchResult.parsedDates,
            blank_dates: fetchResult.blankDates,
            effective_mapping: fetchResult.effective,
            connected_google_email: connectedGoogleEmail,
            used_custom_mapping: usedCustomMapping,
          };
        } else {
          travelDebug = {
            status: "ok",
            message: "Travel rows loaded and matched at least one date in this week.",
            fetched_dates: fetchedDates.length,
            week_matches: weekMatches,
            parsed_dates: fetchResult.parsedDates,
            blank_dates: fetchResult.blankDates,
            effective_mapping: fetchResult.effective,
            connected_google_email: connectedGoogleEmail,
            used_custom_mapping: usedCustomMapping,
          };
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown travel sheet error.";
      const { reason, hint } = classifyTravelFetchError(error);
      travelDebug = {
        status: "error",
        reason,
        message: errMsg,
        hint,
        fetched_dates: 0,
        week_matches: 0,
        connected_google_email: connectedGoogleEmail,
        used_custom_mapping: usedCustomMapping,
      };
      // Non-blocking: tracker remains available even if travel sheet access fails.
    }
  } else {
    travelDebug = {
      status: "not_attempted",
      message: "Travel fetch skipped for fast initial week load.",
      fetched_dates: 0,
      week_matches: 0,
    };
  }

  // Attribute each compensated day in this week to the overtime-earning days
  // that fund it (FIFO over the user's full history). Computed on every load —
  // not gated behind the slow travel fetch — so it stays fresh through the
  // background reconcile that runs after a compensate (which loads with
  // includeTravel=0). It's a DB-only scan; the per-source client/location
  // lookup happens client-side from travel_by_date.
  let compSources: Record<string, CompSource[]> = {};
  const userId = String(claims.sub ?? "");
  if (userId) {
    try {
      compSources = await computeCompSourcesForUser(supabase, userId, weekStart, weekEnd);
    } catch {
      // Non-blocking: the tracker stays usable even if attribution fails.
      compSources = {};
    }
  }

  return NextResponse.json({
    week_start: weekStart,
    week_end: weekEnd,
    target_mins: TARGET_MINS,
    week_hours_mins: weekHoursMins,
    overtime_bank_mins: overtimeBankMins,
    days: weekDays,
    travel_by_date: travelByDate,
    travel_debug: travelDebug,
    comp_sources: compSources,
    includes_travel: includeTravel,
    includes_bank: includesBank,
  });
}
