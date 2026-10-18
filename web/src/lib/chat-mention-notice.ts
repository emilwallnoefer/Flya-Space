import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/send";
import { pushToUsers } from "@/lib/push/notify-users";
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
  const payload = renderMentionPush({
    messageId: params.messageId,
    senderName: params.senderName,
    body: params.body,
    attachmentName: params.attachmentName,
  });

  // A mention that could not be delivered within a few hours is old news.
  const result = await pushToUsers(admin, targets, payload, { ttlSeconds: 6 * 60 * 60 });
  for (const error of result.errors) console.warn("Chat mention notice: push failed:", error);
  return { sent: result.sent, devices: result.devices };
}
