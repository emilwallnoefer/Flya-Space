import "server-only";

import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { canUseModule, GATED_MODULE_LABELS, readModuleGrants, type GatedModule } from "@/lib/role-access";
import { normalizeUserRole, type UserRole } from "@/lib/user-role";

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
  return roleOf(user) !== null;
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
 * For a Mail, Time Tracker or Fleet route, after `forbidHeldAccount()`:
 * returns a 403 if the account's role does not include that module
 * (lib/role-access.ts), or null to carry on. The dashboard hides the module
 * for those roles; this is what stops a direct call.
 */
export function forbidWithoutModule(
  user: { email?: string | null; app_metadata?: unknown },
  module: GatedModule,
): NextResponse | null {
  if (userCanUseModule(user, module)) return null;
  return NextResponse.json({ error: `Your role does not include ${GATED_MODULE_LABELS[module]}.` }, { status: 403 });
}

/** The same question as `forbidWithoutModule`, as a boolean. */
export function userCanUseModule(
  user: { email?: string | null; app_metadata?: unknown },
  module: GatedModule,
): boolean {
  return canUseModule(roleOf(user), isAdminEmail(user.email), module, readModuleGrants(user.app_metadata));
}

function roleOf(user: { app_metadata?: unknown }): UserRole | null {
  const metadata =
    user.app_metadata && typeof user.app_metadata === "object" && !Array.isArray(user.app_metadata)
      ? (user.app_metadata as Record<string, unknown>)
      : {};
  return normalizeUserRole(metadata.role);
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
  return decodeClaims(accessToken)?.role ?? null;
}

/**
 * The claims the session refresher compares against the fresh user: the role
 * (above) and the appearance, which the root layout reads from the token too.
 * Changing the skin on one device reissues that device's token
 * (api/settings/appearance), but every other device keeps its old token — and
 * so its old skin — until the token expires. Comparing here, on the
 * `getUser()` the middleware already makes, lets the other device catch up on
 * its next page load instead of up to an hour later.
 */
export type TokenClaims = { role: string | null; grants: string; theme: string | null; accent: string | null };

function decodeClaims(accessToken: string | null | undefined): TokenClaims | null {
  if (!accessToken) return null;
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      app_metadata?: { role?: unknown };
      user_metadata?: { appearance_theme?: unknown; appearance_accent?: unknown };
    };
    return {
      role: str(claims.app_metadata?.role),
      grants: grantsKey(claims.app_metadata),
      theme: str(claims.user_metadata?.appearance_theme),
      accent: str(claims.user_metadata?.appearance_accent),
    };
  } catch {
    return null;
  }
}

/** The module grants as one comparable string (lib/role-access.ts). */
function grantsKey(appMetadata: unknown): string {
  return readModuleGrants(appMetadata).join(",");
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * True when an access token was issued before the account's role, module
 * grants or appearance last changed, i.e. the session should be reissued now. `user` is the fresh
 * record from `getUser()`.
 */
export function accessTokenIsStale(
  accessToken: string | null | undefined,
  user: { app_metadata?: unknown; user_metadata?: unknown },
): boolean {
  const inToken = decodeClaims(accessToken);
  if (!inToken) return false;
  const app = (user.app_metadata ?? {}) as { role?: unknown };
  const meta = (user.user_metadata ?? {}) as { appearance_theme?: unknown; appearance_accent?: unknown };
  return (
    inToken.role !== str(app.role) ||
    inToken.grants !== grantsKey(user.app_metadata) ||
    inToken.theme !== str(meta.appearance_theme) ||
    inToken.accent !== str(meta.appearance_accent)
  );
}
