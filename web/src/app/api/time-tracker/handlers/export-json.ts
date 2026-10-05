import { NextResponse } from "next/server";
import { sanitizeMins } from "@/lib/time-tracker-queries";
import type { PostActionContext } from "./shared";
import type { ImportPayload } from "./schemas";
import { serverError } from "@/lib/api-errors";

export async function handleExportJson(ctx: PostActionContext): Promise<NextResponse> {
  const { supabase, userId } = ctx;
  const [dayLogsRes, compRes] = await Promise.all([
    supabase
      .from("time_day_logs")
      .select("id, work_date, start_time, stop_time, net_mins, holiday, public_holiday, sick_leave")
      .eq("user_id", userId)
      .order("work_date", { ascending: true }),
    supabase
      .from("time_comp_adjustments")
      .select("work_date, mins, note")
      .eq("user_id", userId)
      .order("work_date", { ascending: true }),
  ]);
  if (dayLogsRes.error) return serverError("time-tracker/export-json", dayLogsRes.error);
  if (compRes.error) return serverError("time-tracker/export-json", compRes.error);

  const dayLogs = dayLogsRes.data ?? [];
  const dayLogIds = dayLogs.map((row) => row.id);
  const breaksRes =
    dayLogIds.length > 0
      ? await supabase
          .from("time_day_breaks")
          .select("day_log_id, position, name, mins")
          .in("day_log_id", dayLogIds)
          .order("position", { ascending: true })
      : { data: [], error: null };
  if (breaksRes.error) return serverError("time-tracker/export-json", breaksRes.error);

  const breaksByLogId = new Map<number, Array<{ name: string; mins: number }>>();
  for (const row of breaksRes.data ?? []) {
    const list = breaksByLogId.get(row.day_log_id) ?? [];
    list.push({ name: row.name ?? "", mins: sanitizeMins(row.mins) });
    breaksByLogId.set(row.day_log_id, list);
  }

  const work: ImportPayload["work"] = {};
  for (const row of dayLogs) {
    work[row.work_date] = {
      start: row.start_time ?? "",
      stop: row.stop_time ?? "",
      breaks: breaksByLogId.get(row.id) ?? [],
      netMins: sanitizeMins(row.net_mins),
      holiday: Boolean(row.holiday),
      publicHoliday: Boolean(row.public_holiday),
      sickLeave: Boolean(row.sick_leave),
    };
  }

  const comp: ImportPayload["comp"] = {};
  for (const row of compRes.data ?? []) {
    comp[row.work_date] = {
      mins: sanitizeMins(row.mins),
      note: row.note ?? "",
    };
  }

  return NextResponse.json({ work, comp });
}
