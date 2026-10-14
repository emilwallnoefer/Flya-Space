import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPushConfigured, sendPush, type PushSubscriptionRow } from "@/lib/push/send";
import { excerpt } from "@/lib/chat-mentions";

/** Where a tap on the notification lands: the dashboard with the chat open. */
export const CHAT_MENTION_DEEP_LINK = "/dashboard?chat=open";

/** The push as the mentioned person's phone shows it. Pure, for tests. */
export function renderMentionPush(input: {
  messageId: string;
  senderName: string;
  body: string | null;
  attachmentName: string | null;
}) {
  const text = excerpt(input.body, input.attachmentName, 120);
  return {
    title: `${input.senderName} mentioned you`,
    body: text || "In Team chat",
    url: CHAT_MENTION_DEEP_LINK,
    tag: `chat-mention-${input.messageId}`,
  };
}

/**
 * Pushes "X mentioned you" to every device of the mentioned people that has
 * notifications on (Settings → Notifications). Best effort: nobody with no
 * device subscribed hears anything, a push failure is a warning in the logs,
 * and the message itself is already saved either way. Devices the push
 * service reports gone are deleted, as the reminder cron does.
 *
 * The caller (app/api/chat/mention) has verified the session, the role, and
 * that the message belongs to the caller; this only needs the service role to
 * read other people's subscriptions.
 */
export async function notifyChatMentions(params: {
  messageId: string;
  senderId: string;
  senderName: string;
  body: string | null;
  attachmentName: string | null;
  userIds: string[];
}): Promise<{ sent: number; devices: number }> {
  const targets = Array.from(new Set(params.userIds)).filter((id) => id !== params.senderId);
  if (targets.length === 0 || !isPushConfigured()) return { sent: 0, devices: 0 };

  const admin = createAdminClient();
  const { data: devices, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", targets);
  if (error) {
    console.warn("Chat mention notice: could not read subscriptions:", error.message);
    return { sent: 0, devices: 0 };
  }
  if (!devices || devices.length === 0) return { sent: 0, devices: 0 };

  const payload = renderMentionPush({
    messageId: params.messageId,
    senderName: params.senderName,
    body: params.body,
    attachmentName: params.attachmentName,
  });

  let sent = 0;
  const goneIds: string[] = [];
  await Promise.all(
    (devices as Array<PushSubscriptionRow & { id: string; user_id: string }>).map(async (device) => {
      // A mention that could not be delivered within a few hours is old news.
      const result = await sendPush(device, payload, { ttlSeconds: 6 * 60 * 60 });
      if (result.ok) sent += 1;
      else if (result.gone) goneIds.push(device.id);
      else console.warn("Chat mention notice: push failed:", result.error);
    }),
  );
  if (goneIds.length > 0) await admin.from("push_subscriptions").delete().in("id", goneIds);
  if (sent > 0) {
    const okIds = devices.filter((d) => !goneIds.includes(d.id)).map((d) => d.id);
    await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", okIds);
  }
  return { sent, devices: devices.length };
}
