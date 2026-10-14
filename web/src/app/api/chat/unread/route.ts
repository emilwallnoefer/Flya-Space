import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";

/**
 * GET /api/chat/unread — what the phone's Chat tab needs to show its badge
 * without loading the chat (and supabase-js) itself: the caller's user id and
 * the timestamps of the latest messages, each flagged as the caller's own or
 * not. The browser compares them with its per-user "last read" mark (kept in
 * localStorage, see components/chat/hooks/chat-last-read.ts), which the
 * server cannot see.
 *
 * Read with the caller's session, so RLS decides what they may see. Limited
 * to 100 rows — the badge caps at 99+.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const { data, error } = await supabase
    .from("chat_messages")
    .select("created_at, sender_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "Could not read the chat." }, { status: 500 });

  return NextResponse.json(
    {
      user_id: user.id,
      recent: (data ?? []).map((row) => ({ created_at: row.created_at as string, mine: row.sender_id === user.id })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
