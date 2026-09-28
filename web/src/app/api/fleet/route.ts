import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { DEFAULT_WINDOW_DAYS, todayInZurich } from "@/lib/fleet-queries";
import { buildDemoBoard } from "@/lib/fleet-demo";
import { buildFleetBoard } from "@/lib/fleet-board";
import { mondayOf } from "@/lib/fleet-rules";
import { parseBoardWindow } from "./window";
import { isMissingFleetTable } from "./missing-table";
import { postSchema, type PostPayload } from "./handlers/schemas";
import { appBaseUrl, resolveViewer, type Admin, type FleetActionContext, type Viewer } from "./handlers/shared";
import { handleReserve } from "./handlers/reserve";
import { handleCancel } from "./handlers/cancel";
import { handleCheckOut } from "./handlers/check-out";
import { handleCheckIn } from "./handlers/check-in";
import { handleMove } from "./handlers/move";
import { handleConfirmLocation } from "./handlers/confirm-location";
import { handleSetStatus } from "./handlers/set-status";
import { handleClaimHolder } from "./handlers/claim-holder";
import { handleSetReminders } from "./handlers/set-reminders";
import { handleAssign } from "./handlers/assign";
import { handleReturnToPool } from "./handlers/return-to-pool";
import { handleCreateAsset } from "./handlers/create-asset";
import { handleUpdateAsset } from "./handlers/update-asset";
import { handleArchiveAsset } from "./handlers/archive-asset";
import { handleRegisterMember } from "./handlers/register-member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fleet API.
 *
 * Reads are open to any signed-in user (the fleet is shared property). Writes
 * run on the service-role client, because the rules that make the module work
 * cannot be expressed as RLS:
 *
 *  - you may only book within the horizon your reliability score earns;
 *  - you may only cancel or check in *your own* booking (admins: anyone's);
 *  - a contested week puts you on a waitlist ordered by score, not by luck.
 *
 * `fleet_assets` / `fleet_reservations` grant no INSERT/UPDATE to `authenticated`,
 * so this route is the only writer.
 *
 * This file is the dispatcher: session, rate limit, validation, routing, and the
 * board that rides back with a successful write. One action per module under
 * `handlers/`, the same split as `api/time-tracker`.
 */

export async function GET(request: Request) {
  const viewer = await resolveViewer();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const boardWindow = parseBoardWindow(request, DEFAULT_WINDOW_DAYS);
  if (!boardWindow) return NextResponse.json({ error: "Invalid start date." }, { status: 400 });
  const { windowStart, windowDays } = boardWindow;

  try {
    const admin = createAdminClient();
    return NextResponse.json(await buildFleetBoard(admin, viewer, boardWindow, { autoLink: true }));
  } catch (error) {
    // The fleet tables are created by a hand-applied migration
    // (supabase/2026-09-01-fleet-management.sql). Until it has been run, serve a
    // labelled demo board OUTSIDE production so the UI can be reviewed and
    // adjusted. Never in production, and never when the tables exist — a real
    // fleet that happens to be empty must render as empty.
    if (process.env.NODE_ENV !== "production" && isMissingFleetTable(error)) {
      const today = todayInZurich();
      return NextResponse.json({
        ...buildDemoBoard({
          viewerId: viewer.id,
          viewerName: viewer.email?.split("@")[0] ?? "You",
          today,
          windowStart: mondayOf(windowStart ?? today),
          windowDays,
        }),
        is_admin: viewer.isAdmin,
      });
    }
    console.error("GET /api/fleet failed", error);
    return NextResponse.json({ error: "Could not load the fleet." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const viewer = await resolveViewer();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientIp = getClientIp(request);
  const limit = await checkRateLimit(`fleet-write:${viewer.id}:${clientIp}`, {
    windowMs: 60 * 60 * 1000,
    max: 240,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const payload = parsed.data;
  const admin = createAdminClient();
  const today = todayInZurich();

  let result: NextResponse;
  try {
    result = await dispatch({ admin, viewer, today, origin: appBaseUrl(request) }, payload);
  } catch (error) {
    console.error(`POST /api/fleet (${payload.action}) failed`, error);
    return NextResponse.json({ error: "Could not complete that action." }, { status: 500 });
  }

  // The write is done. Hand back the refreshed board with it, so the client does
  // not have to ask for one — that second request is a whole extra function
  // invocation and its own `auth.getUser()` round trip, on top of re-reading
  // everything this request already has a warm connection for.
  if (!result.ok) return result;
  return await withFreshBoard(result, admin, viewer, request, payload.action);
}

/**
 * Attaches a freshly built board to a successful write response.
 *
 * The write has already happened by this point, so a failure here must never
 * turn into a failed action: the original response goes back untouched and the
 * client falls back to fetching the board itself.
 */
async function withFreshBoard(
  result: NextResponse,
  admin: Admin,
  viewer: Viewer,
  request: Request,
  action: string,
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await result.clone().json()) as Record<string, unknown>;
  } catch {
    return result;
  }

  try {
    // A malformed window must not cost anyone their booking, so an unparseable
    // one falls back to the default window rather than failing the request.
    const boardWindow = parseBoardWindow(request, DEFAULT_WINDOW_DAYS) ?? {
      windowDays: DEFAULT_WINDOW_DAYS,
    };
    const board = await buildFleetBoard(admin, viewer, boardWindow, { autoLink: false });
    return NextResponse.json({ ...body, board });
  } catch (error) {
    console.error(`POST /api/fleet (${action}) succeeded but the board refresh failed`, error);
    return NextResponse.json(body);
  }
}

/** Routes one validated payload to its handler. */
async function dispatch(ctx: FleetActionContext, payload: PostPayload): Promise<NextResponse> {
  switch (payload.action) {
    case "reserve":
      return await handleReserve(ctx, payload);
    case "cancel":
      return await handleCancel(ctx, payload);
    case "check_out":
      return await handleCheckOut(ctx, payload);
    case "check_in":
      return await handleCheckIn(ctx, payload);
    case "move":
      return await handleMove(ctx, payload);
    case "confirm_location":
      return await handleConfirmLocation(ctx, payload);
    case "set_status":
      return await handleSetStatus(ctx, payload);
    case "claim_holder":
      return await handleClaimHolder(ctx, payload);
    case "set_reminders":
      return await handleSetReminders(ctx, payload);
    case "assign":
      return await handleAssign(ctx, payload);
    case "return_to_pool":
      return await handleReturnToPool(ctx, payload);
    case "create_asset":
      return await handleCreateAsset(ctx, payload);
    case "update_asset":
      return await handleUpdateAsset(ctx, payload);
    case "archive_asset":
      return await handleArchiveAsset(ctx, payload);
    case "register_member":
      return await handleRegisterMember(ctx);
  }
}
