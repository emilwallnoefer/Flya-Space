/**
 * The "somebody new is waiting for a role" mail sent to every address in
 * `ADMIN_EMAILS`.
 *
 * Deliberately pure and dependency-free — no env, no Supabase, no `Date.now()`
 * — so the exact strings an admin receives can be asserted in a unit test.
 * `lib/role-assignment-notice.ts` is the "server-only" side that claims the
 * send-once row and hands the result to Resend; this module only renders.
 *
 * Modelled on `lib/certificate-request.ts`, which shares its formatter between
 * a route and the UI for the same reason: one renderer, no drift.
 */

/** Where the admin lands: Admin -> Users & roles, already open. */
export const ROLE_ASSIGNMENT_DEEP_LINK = "/dashboard?module=admin&section=users";

export type RoleAssignmentNoticeInput = {
  /** The new account's sign-in address. */
  email: string;
  /**
   * Their display name if the account carries one. Blank/absent is normal for a
   * brand-new sign-up, and the mail then leans on the email alone.
   */
  name?: string | null;
  /** Absolute origin of the dashboard, without a trailing slash. */
  baseUrl: string;
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * "Ada Lovelace (ada@flya.space)" when a name is known, otherwise just the
 * address. Whitespace-only names count as absent — Supabase happily stores one.
 */
export function describeNewUser(input: Pick<RoleAssignmentNoticeInput, "email" | "name">): string {
  const email = input.email.trim();
  const name = (input.name ?? "").trim();
  if (!name || name.toLowerCase() === email.toLowerCase()) return email;
  return `${name} (${email})`;
}

/** Joins the origin and the deep link without doubling or dropping the slash. */
export function roleAssignmentUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${ROLE_ASSIGNMENT_DEEP_LINK}`;
}

export function renderRoleAssignmentNotice(input: RoleAssignmentNoticeInput): RenderedEmail {
  const who = describeNewUser(input);
  const url = roleAssignmentUrl(input.baseUrl);

  const subject = `${input.email.trim()} has signed up — assign a role`;
  const opener = `${who} has signed up and is waiting for a role.`;
  const consequence =
    "Until a role is assigned they cannot reach any module — they see a holding screen and nothing else. Open Users & roles and pick one.";

  const text = [
    "Hi,",
    "",
    opener,
    "",
    consequence,
    "",
    `Assign a role here: ${url}`,
    "",
    "— Flya Space",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b1120;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
    <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:14px;padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#38bdf8;">Flya Space</p>
      <h1 style="margin:0 0 18px;font-size:19px;font-weight:600;color:#f8fafc;">New sign-up needs a role</h1>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">${escapeHtml(opener)}</p>
      <p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#94a3b8;">${escapeHtml(consequence)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#22d3ee;color:#0b1120;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9px;">Assign a role</a>
      <p style="margin:22px 0 0;font-size:12px;color:#64748b;">— Flya Space</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
