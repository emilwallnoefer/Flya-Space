import { NextResponse } from "next/server";
import { sanitizeText } from "@/lib/security/input-sanitize";
import { sanitizeMins } from "@/lib/time-tracker-queries";
import { isDateKey, type PostActionContext } from "./shared";
import type { PostPayload } from "./schemas";
import { serverError } from "@/lib/api-errors";

type SaveDayPayload = Extract<PostPayload, { action: "save_day" }>;

export async function handleSaveDay(
  ctx: PostActionContext,
  payload: SaveDayPayload,
): Promise<NextResponse> {
  const { supabase, userId, requireSnapshot } = ctx;
  const day = payload.day;
  if (!day?.work_date || !isDateKey(day.work_date)) {
    return NextResponse.json({ error: "Invalid work_date" }, { status: 400 });
  }

  const snapshotErr = await requireSnapshot(`before_save_day_${day.work_date}`);
  if (snapshotErr) return snapshotErr;

  const saveRes = await supabase
    .from("time_day_logs")
    .upsert(
      {
        user_id: userId,
        work_date: day.work_date,
        start_time: sanitizeText(day.start_time, { maxLen: 8 }),
        stop_time: sanitizeText(day.stop_time, { maxLen: 8 }),
        net_mins: sanitizeMins(day.net_mins),
        holiday: Boolean(day.holiday),
        public_holiday: Boolean(day.public_holiday),
        sick_leave: Boolean(day.sick_leave),
        source: "ui",
      },
      { onConflict: "user_id,work_date" },
    )
    .select("id")
    .single();

  if (saveRes.error) return serverError("time-tracker/save-day", saveRes.error);

  const dayLogId = saveRes.data.id;
  const clearBreaksRes = await supabase.from("time_day_breaks").delete().eq("day_log_id", dayLogId);
  if (clearBreaksRes.error) return serverError("time-tracker/save-day", clearBreaksRes.error);

  const breaks = (day.breaks ?? []).map((item, index) => ({
    day_log_id: dayLogId,
    position: index,
    name: sanitizeText(item?.name, { maxLen: 120 }),
    mins: sanitizeMins(item?.mins),
  }));

  if (breaks.length > 0) {
    const addBreaksRes = await supabase.from("time_day_breaks").insert(breaks);
    if (addBreaksRes.error) return serverError("time-tracker/save-day", addBreaksRes.error);
  }

  return NextResponse.json({ ok: true });
}
