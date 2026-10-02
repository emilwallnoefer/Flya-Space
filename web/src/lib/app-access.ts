import "server-only";

import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { normalizeUserRole } from "@/lib/user-role";

/**
 * Who may use the app's modules: an admin (`ADMIN_EMAILS`), or anyone an admin
 * has given a role in `app_metadata`. An account without either is "held" — it
 * sees `components/role-gate.tsx` and nothing else.
 *
 * The role gate page used to be the ONLY place this was checked, so a held or
 * role-revoked account could still call every module's API directly (security
 * audit run-4 F3). Every non-admin route now asks this too, via
 * `forbidHeldAccount()`. The database enforces the same line for the tables the
 * browser reads directly: `public.has_app_role()` in
 * `supabase/2026-10-02-require-role.sql`.
 *
 * Deliberately left open to held accounts: `/api/elios-score` (the game is on
 * the role gate itself) and `/api/account/delete`.
 *
 * The role is read from `app_metadata` only — never `user_metadata`, which the
 * user can rewrite. See SECURITY.md T0.1.
 */
export function hasAppAccess(
  user: { email?: string | null; app_metadata?: unknown } | null | undefined,
): boolean {
  if (!user) return false;
  if (isAdminEmail(user.email)) return true;
  const metadata =
    user.app_metadata && typeof user.app_metadata === "object" && !Array.isArray(user.app_metadata)
      ? (user.app_metadata as Record<string, unknown>)
      : {};
  return normalizeUserRole(metadata.role) !== null;
}

/**
 * For a route that has already confirmed a signed-in `user`: returns a 403 to
 * send back if the account is held, or null to carry on.
 */
export function forbidHeldAccount(
  user: { email?: string | null; app_metadata?: unknown },
): NextResponse | null {
  if (hasAppAccess(user)) return null;
  return NextResponse.json(
    { error: "Your account is waiting for an admin to assign a role." },
    { status: 403 },
  );
}

/**
 * The role baked into an access token, or null. Used by the session refresher
 * to spot a token issued before an admin changed the role: the database reads
 * the role from the token (`auth.jwt()`), so until the token is reissued the
 * database still sees the old one.
 *
 * Decodes without verifying — it only decides whether to refresh, never what
 * anyone may do.
 */
export function roleInAccessToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      app_metadata?: { role?: unknown };
    };
    const role = claims.app_metadata?.role;
    return typeof role === "string" && role ? role : null;
  } catch {
    return null;
  }
}
