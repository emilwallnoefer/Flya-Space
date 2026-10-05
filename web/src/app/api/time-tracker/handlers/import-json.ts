import { NextResponse } from "next/server";
import { sanitizeText } from "@/lib/security/input-sanitize";
import { sanitizeMins } from "@/lib/time-tracker-queries";
import { isDateKey, type PostActionContext } from "./shared";
import type { PostPayload } from "./schemas";
import { serverError } from "@/lib/api-errors";

type ImportJsonPayload = Extract<PostPayload, { action: "import_json" }>;

export async function handleImportJson(
  ctx: PostActionContext,
  payload: ImportJsonPayload,
): Promise<NextResponse> {
  const { supabase, userId, requireSnapshot } = ctx;
  const snapshotErr = await requireSnapshot("before_import_json");
  if (snapshotErr) return snapshotErr;

  const input = payload.data;
  const workEntries = Object.entries(input.work ?? {}).filter(([date]) => isDateKey(date));
  const compEntries = Object.entries(input.comp ?? {}).filter(([date]) => isDateKey(date));

  const dayRows = workEntries.map(([date, item]) => ({
    user_id: userId,
    work_date: date,
    start_time: sanitizeText(item?.start, { maxLen: 8 }),
    stop_time: sanitizeText(item?.stop, { maxLen: 8 }),
    net_mins: sanitizeMins(item?.netMins),
    holiday: Boolean(item?.holiday),
    public_holiday: Boolean(item?.publicHoliday),
    sick_leave: Boolean(item?.sickLeave),
    source: "hourlogger_import_ui",
  }));

  if (dayRows.length > 0) {
    const upsertDaysRes = await supabase.from("time_day_logs").upsert(dayRows, {
      onConflict: "user_id,work_date",
    });
    if (upsertDaysRes.error) return serverError("time-tracker/import-json", upsertDaysRes.error);
  }

  const dayLookupRes = await supabase
    .from("time_day_logs")
    .select("id, work_date")
    .eq("user_id", userId)
    .in(
      "work_date",
      workEntries.map(([date]) => date),
    );
  if (dayLookupRes.error) return serverError("time-tracker/import-json", dayLookupRes.error);

  const dayIdByDate = new Map((dayLookupRes.data ?? []).map((row) => [row.work_date, row.id]));
  const allDayIds = (dayLookupRes.data ?? []).map((row) => row.id);
  if (allDayIds.length > 0) {
    const clearRes = await supabase.from("time_day_breaks").delete().in("day_log_id", allDayIds);
    if (clearRes.error) return serverError("time-tracker/import-json", clearRes.error);
  }

  const breakRows = workEntries.flatMap(([date, item]) => {
    const dayLogId = dayIdByDate.get(date);
    if (!dayLogId) return [];
    const breaks = Array.isArray(item?.breaks) ? item.breaks : [];
    return breaks.map((entry, index) => ({
      day_log_id: dayLogId,
      position: index,
      name: sanitizeText(entry?.name, { maxLen: 120 }),
      mins: sanitizeMins(entry?.mins),
    }));
  });

  if (breakRows.length > 0) {
    const addBreaksRes = await supabase.from("time_day_breaks").insert(breakRows);
    if (addBreaksRes.error) return serverError("time-tracker/import-json", addBreaksRes.error);
  }

  const compRows = compEntries.map(([date, item]) => ({
    user_id: userId,
    work_date: date,
    mins: sanitizeMins(item?.mins),
    note: sanitizeText(item?.note, { maxLen: 500, allowNewlines: true }),
    source: "hourlogger_import_ui",
  }));

  if (compRows.length > 0) {
    const upsertCompRes = await supabase.from("time_comp_adjustments").upsert(compRows, {
      onConflict: "user_id,work_date",
    });
    if (upsertCompRes.error) return serverError("time-tracker/import-json", upsertCompRes.error);
  }

  return NextResponse.json({
    ok: true,
    imported_day_logs: dayRows.length,
    imported_break_rows: breakRows.length,
    imported_comp_rows: compRows.length,
  });
}
