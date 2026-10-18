import "server-only";

import { getAdminEmails, isAdminEmail } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/send";
import { pushToUsers } from "@/lib/push/notify-users";
import { renderPhoneTourPush } from "@/lib/phone-tour-notice-email";

/**
 * A quick push to the admins' phones when somebody clicks through the phone
 * walkthrough: once per person, only to admin devices that have
 * notifications on, and nothing else (no mail, nothing the person sees).
 *
 * ONCE-ONLY. `phone_tour_completions.user_id` is the primary key and the row
 * is INSERTed *before* anything is sent — a second Done (`?tour=phone`
 * re-opens the tour), a double-click or two tabs lose the insert and return.
 * Same claim-before-send shape as `lib/role-assignment-notice.ts`.
 *
 * BEST EFFORT. Called from a fire-and-forget request the tour makes; a
 * missing migration or missing VAPID keys end as a `console.warn` and a
 * `failed` row. Nothing the person sees depends on it.
 */
export type PhoneTourNoticeOutcome = "sent" | "already_notified" | "self" | "no_admins" | "not_configured" | "failed";

type Admin = ReturnType<typeof createAdminClient>;

/** The auth user ids behind `ADMIN_EMAILS`, so their devices can be found. */
async function adminUserIds(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error || !data) return [];
  return data.users.filter((user) => isAdminEmail(user.email)).map((user) => user.id);
}

/** Pushes to every admin device; prunes the ones the push service says are gone. */
async function pushAdmins(admin: Admin, payload: ReturnType<typeof renderPhoneTourPush>): Promise<{ sent: number; error: string | null }> {
  const ids = await adminUserIds(admin);
  if (ids.length === 0) return { sent: 0, error: "No admin accounts found." };
  const result = await pushToUsers(admin, ids, payload, { ttlSeconds: 6 * 60 * 60 });
  if (result.devices === 0) {
    return { sent: 0, error: result.errors[0] ?? "No admin device has notifications on." };
  }
  return { sent: result.sent, error: result.errors.length > 0 ? result.errors.join("; ") : null };
}

export async function notifyAdminsOfPhoneTourCompletion(params: {
  userId: string;
  email: string;
  name?: string | null;
}): Promise<PhoneTourNoticeOutcome> {
  const { userId, email } = params;
  if (!userId || !email) return "failed";
  // An admin finishing the tour is nothing to tell the admins about.
  if (isAdminEmail(email)) return "self";
  if (getAdminEmails().length === 0) return "no_admins";

  try {
    const admin = createAdminClient();

    // CLAIM FIRST. Only a unique violation means "already told"; anything
    // else (above all 42P01, the migration not applied) must be loud.
    const { error: claimError } = await admin.from("phone_tour_completions").insert({ user_id: userId, email, status: "sending" });
    if (claimError) {
      if (claimError.code === "23505") return "already_notified";
      console.warn(
        "Phone tour notice: could not claim the send for",
        email,
        `— [${claimError.code ?? "unknown"}] ${claimError.message}.`,
        claimError.code === "42P01" ? "Apply supabase/2026-10-12-phone-tour-completions.sql." : "",
      );
      return "failed";
    }

    if (!isPushConfigured()) {
      await mark(admin, userId, "failed", 0, "Push is not configured (VAPID keys).");
      return "not_configured";
    }

    const { sent, error } = await pushAdmins(admin, renderPhoneTourPush({ userId, email, name: params.name }));
    if (error) console.warn("Phone tour notice:", error, "for", email);
    await mark(admin, userId, sent > 0 ? "sent" : "failed", sent, error);
    return sent > 0 ? "sent" : "failed";
  } catch (error) {
    console.warn("Phone tour notice threw for", email, (error as Error).message);
    return "failed";
  }
}

async function mark(admin: Admin, userId: string, status: "sent" | "failed", pushed: number, error: string | null): Promise<void> {
  try {
    await admin
      .from("phone_tour_completions")
      .update({ status, pushed, error, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } catch (err) {
    console.warn("Phone tour notice: could not record outcome", (err as Error).message);
  }
}
