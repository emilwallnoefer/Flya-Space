import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { handleGetWeek } from "./handlers/get-week";
import { postPayloadSchema } from "./handlers/schemas";
import { createSnapshotGuard, type PostActionContext } from "./handlers/shared";
import { handleSaveDay } from "./handlers/save-day";
import { handleResetDay } from "./handlers/reset-day";
import { handleFillMissing } from "./handlers/fill-missing";
import { handleSetComp } from "./handlers/set-comp";
import { handleImportJson } from "./handlers/import-json";
import { handleExportJson } from "./handlers/export-json";
import { forbidHeldAccount } from "@/lib/app-access";

export async function GET(request: Request) {
  return handleGetWeek(request);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  const authedUser = user;
  const clientIp = getClientIp(request);
  const limitResult = await checkRateLimit(`time-tracker-write:${authedUser.id}:${clientIp}`, {
    windowMs: 60 * 60 * 1000,
    max: 180,
  });
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limitResult) },
    );
  }

  const parsedPayload = postPayloadSchema.safeParse(await request.json());
  if (!parsedPayload.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const payload = parsedPayload.data;

  const ctx: PostActionContext = {
    supabase,
    userId: authedUser.id,
    requireSnapshot: createSnapshotGuard(supabase, authedUser.id),
  };

  switch (payload.action) {
    case "save_day":
      return handleSaveDay(ctx, payload);
    case "reset_day":
      return handleResetDay(ctx, payload);
    case "fill_missing":
      return handleFillMissing(ctx, payload);
    case "set_comp":
      return handleSetComp(ctx, payload);
    case "import_json":
      return handleImportJson(ctx, payload);
    case "export_json":
      return handleExportJson(ctx);
    default:
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
}
