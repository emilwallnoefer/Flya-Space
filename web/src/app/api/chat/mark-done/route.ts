import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverError } from "@/lib/api-errors";

/**
 * POST /api/chat/mark-done
 *
 * Admin-only. Flips a chat message's `done_at` / `done_by` columns. Used to
 * resolve feature_request / change_request entries so they drop out of the
 * filtered request lists in the chat widget.
 *
 * RLS on `chat_messages` only lets the message author UPDATE — and even then
 * only the `body` and `edited_at` columns thanks to column-level grants in
 * the migration. Setting `done_at` / `done_by` therefore goes through this
 * route, which uses the service-role key after a hard admin check.
 */

const bodySchema = z.object({
  message_id: z.string().uuid(),
  done: z.boolean(),
});

export async function POST(request: Request) {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const { message_id, done } = parsed.data;

  const admin = createAdminClient();
  const update = done
    ? { done_at: new Date().toISOString(), done_by: guard.user.id }
    : { done_at: null, done_by: null };

  const { data, error } = await admin
    .from("chat_messages")
    .update(update)
    .eq("id", message_id)
    .select(
      "id, sender_id, sender_email, body, attachment_path, attachment_name, attachment_type, attachment_size, created_at, kind, done_at, done_by, edited_at",
    )
    .single();

  if (error) {
    return serverError("chat/mark-done", error);
  }
  if (!data) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: data });
}
