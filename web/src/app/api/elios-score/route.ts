import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayNameFor } from "@/lib/fleet-queries";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import {
  LEADERBOARD_LIMIT,
  firstNameOf,
  isCurrentRules,
  parseSubmittedScore,
  rankBoard,
  shouldRecord,
} from "@/lib/elios-leaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The leaderboard for "Fly where people can't".
 *
 * GET returns the top scores; POST submits one. Both require a session — this
 * is a workspace board, not a public one.
 *
 * The name is taken from the session every time, never from the request body.
 * A posted name would let anyone enter the board as a colleague, which matters
 * more here than the score does: the score is only bragging rights, but a name
 * is somebody else's.
 *
 * The score itself comes from the player's browser and cannot be verified. It
 * is clamped to something plausible and only ever improved, so the worst case
 * is a colleague with an inflated number, not a broken board.
 */

type Row = { user_id: string; first_name: string; score: number; achieved_at: string };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("elios_scores")
    .select("user_id, first_name, score, achieved_at")
    .order("score", { ascending: false })
    .order("achieved_at", { ascending: true })
    .limit(LEADERBOARD_LIMIT);

  if (error) {
    // An unapplied migration must not break the game around it.
    console.warn("elios-score: could not read the board —", error.message);
    return NextResponse.json({ board: [] });
  }

  const board = rankBoard(
    (data ?? []).map((r: Row) => ({
      userId: r.user_id,
      name: r.first_name,
      score: r.score,
      achievedAt: r.achieved_at,
    })),
    user.id,
  );
  return NextResponse.json({ board });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit(`elios-score:${user.id}:${getClientIp(request)}`, {
    windowMs: 60 * 60 * 1000,
    max: 120,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many submissions." },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const submitted = body as { score?: unknown; rules?: unknown } | null;
  // A 400 tells the client to drop the score rather than retry it, which is
  // exactly right for one flown under rules the board no longer counts.
  if (!isCurrentRules(submitted?.rules)) {
    return NextResponse.json({ error: "Flown under older rules" }, { status: 400 });
  }
  const score = parseSubmittedScore(submitted?.score);
  if (score === null) return NextResponse.json({ error: "Not a score" }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("elios_scores")
    .select("score")
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) {
    console.warn("elios-score: could not read the current best —", readError.message);
    return NextResponse.json({ recorded: false });
  }

  if (!shouldRecord(score, existing?.score ?? null)) {
    return NextResponse.json({ recorded: false, best: existing?.score ?? null });
  }

  // Derived from the session, never from the body.
  const firstName = firstNameOf(displayNameFor({ email: user.email, identities: user.identities }));

  const { error: writeError } = await admin.from("elios_scores").upsert(
    { user_id: user.id, first_name: firstName, score, achieved_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );

  if (writeError) {
    console.warn("elios-score: could not record —", writeError.message);
    return NextResponse.json({ recorded: false });
  }

  return NextResponse.json({ recorded: true, best: score });
}
