import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { displayNameFor } from "@/lib/fleet-queries";
import { notifyChatMentions } from "@/lib/chat-mention-notice";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";

/**
 * POST /api/chat/mention — after a message is saved, the sender asks us to
 * tell the people it @-mentions (a push to their phones, see
 * lib/chat-mention-notice.ts). The body carries the message id and the
 * mentioned user ids as the client resolved them from the team list.
 *
 * Only the message's own sender may trigger it: the message is read back with
 * the caller's session (RLS), and its sender_id must be the caller. That is
 * what stops anyone pushing "X mentioned you" to a colleague's phone about a
 * message X did not write. The sender's name comes from the sign-in provider,
 * not from anything the client sent.
 */
const bodySchema = z.object({
  message_id: z.string().uuid(),
  user_ids: z.array(z.string().uuid()).min(1).max(25),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const limit = await checkRateLimit(`chat-mention:${user.id}:${getClientIp(request)}`, {
    windowMs: 60 * 60 * 1000,
    max: 120,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Please retry later." }, { status: 429, headers: createRateLimitHeaders(limit) });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  const { message_id, user_ids } = parsed.data;

  const { data: message, error } = await supabase
    .from("chat_messages")
    .select("id, sender_id, body, attachment_name")
    .eq("id", message_id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the message." }, { status: 500 });
  if (!message) return NextResponse.json({ error: "Message not found." }, { status: 404 });
  if (message.sender_id !== user.id) return NextResponse.json({ error: "Not your message." }, { status: 403 });

  const outcome = await notifyChatMentions({
    messageId: message.id,
    senderId: user.id,
    senderName: displayNameFor({ email: user.email, identities: user.identities }),
    body: message.body,
    attachmentName: message.attachment_name,
    userIds: user_ids,
  });
  return NextResponse.json({ ok: true, ...outcome });
}
