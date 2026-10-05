import { NextResponse } from "next/server";
import { isDateKey, type PostActionContext } from "./shared";
import type { PostPayload } from "./schemas";
import { serverError } from "@/lib/api-errors";

type ResetDayPayload = Extract<PostPayload, { action: "reset_day" }>;

export async function handleResetDay(
  ctx: PostActionContext,
  payload: ResetDayPayload,
): Promise<NextResponse> {
  const { supabase, userId, requireSnapshot } = ctx;
  const date = payload.work_date;
  if (!date || !isDateKey(date)) return NextResponse.json({ error: "Invalid work_date" }, { status: 400 });

  const snapshotErr = await requireSnapshot(`before_reset_day_${date}`);
  if (snapshotErr) return snapshotErr;

  const deleteLogRes = await supabase
    .from("time_day_logs")
    .delete()
    .eq("user_id", userId)
    .eq("work_date", date);
  if (deleteLogRes.error) return serverError("time-tracker/reset-day", deleteLogRes.error);

  const deleteCompRes = await supabase
    .from("time_comp_adjustments")
    .delete()
    .eq("user_id", userId)
    .eq("work_date", date);
  if (deleteCompRes.error) return serverError("time-tracker/reset-day", deleteCompRes.error);

  return NextResponse.json({ ok: true });
}
