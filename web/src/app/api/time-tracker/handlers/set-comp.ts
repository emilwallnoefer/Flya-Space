import { NextResponse } from "next/server";
import { sanitizeText } from "@/lib/security/input-sanitize";
import { sanitizeMins } from "@/lib/time-tracker-queries";
import { isDateKey, type PostActionContext } from "./shared";
import type { PostPayload } from "./schemas";
import { serverError } from "@/lib/api-errors";

type SetCompPayload = Extract<PostPayload, { action: "set_comp" }>;

export async function handleSetComp(
  ctx: PostActionContext,
  payload: SetCompPayload,
): Promise<NextResponse> {
  const { supabase, userId, requireSnapshot } = ctx;
  // Direct write of a compensation value. The client computes the target
  // minutes (and toggles to 0 to clear), so this is a single round-trip with
  // no read-modify-write — unlike `fill_missing`, which derives the value
  // server-side. The overtime-bank cache is refreshed by DB trigger.
  const date = payload.work_date;
  if (!date || !isDateKey(date)) return NextResponse.json({ error: "Invalid work_date" }, { status: 400 });

  const mins = sanitizeMins(payload.mins);
  const snapshotErr = await requireSnapshot(`before_set_comp_${date}`);
  if (snapshotErr) return snapshotErr;

  if (mins > 0) {
    const note = sanitizeText(payload.note, { maxLen: 500, allowNewlines: true }) || "auto-fill";
    const upsertCompRes = await supabase
      .from("time_comp_adjustments")
      .upsert(
        {
          user_id: userId,
          work_date: date,
          mins,
          note,
          source: "ui",
        },
        { onConflict: "user_id,work_date" },
      );
    if (upsertCompRes.error) return serverError("time-tracker/set-comp", upsertCompRes.error);
  } else {
    const deleteCompRes = await supabase
      .from("time_comp_adjustments")
      .delete()
      .eq("user_id", userId)
      .eq("work_date", date);
    if (deleteCompRes.error) return serverError("time-tracker/set-comp", deleteCompRes.error);
  }

  return NextResponse.json({ ok: true, comp_mins: mins });
}
