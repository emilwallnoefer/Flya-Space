/**
 * A chat message can be edited for 10 minutes after it was sent.
 *
 * The UI hides "Edit" when the window closes; the database enforces the limit
 * (`supabase/2026-10-14-chat-edit-window.sql`) with a short grace on top, so
 * an edit opened just before the deadline can still be saved. Keep the two
 * numbers in step.
 */
export const CHAT_EDIT_WINDOW_MS = 10 * 60 * 1000;

/** Milliseconds left to edit a message sent at `createdAt`; 0 once closed. */
export function chatEditTimeLeft(createdAt: string, now: number = Date.now()): number {
  const sent = Date.parse(createdAt);
  if (Number.isNaN(sent)) return 0;
  return Math.max(0, sent + CHAT_EDIT_WINDOW_MS - now);
}

export function canEditChatMessage(createdAt: string, now: number = Date.now()): boolean {
  return chatEditTimeLeft(createdAt, now) > 0;
}
