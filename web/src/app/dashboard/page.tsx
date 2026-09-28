import { DashboardShell } from "@/components/dashboard-shell";
import { RoleGate } from "@/components/role-gate";
import { notifyAdminsOfPendingRole } from "@/lib/role-assignment-notice";
// Deliberately NOT from the shell: it is a client module, and a server
// component importing a value from one gets a reference that throws on use.
import { isModuleKey } from "@/lib/dashboard-modules";
import type { WeekResponse } from "@/components/time-tracker-panel";
import { normalizeUserRole } from "@/lib/user-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAdminEmail } from "@/lib/admin";
import { fetchCurrentUserWeek, getWeekStartDate } from "@/lib/time-tracker-queries";
import { fetchInitialSettings, type InitialSettingsData } from "@/lib/settings-queries";
import {
  fetchAdminTimeOverview,
  fetchAdminUsers,
  type AdminListedUser,
  type AdminTimeOverview,
} from "@/lib/admin-queries";
import { buildFleetBoard, type FleetBoardPayload } from "@/lib/fleet-board";
import { DEFAULT_WINDOW_DAYS, displayNameFor } from "@/lib/fleet-queries";
import { redirect } from "next/navigation";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  // Verify the session locally (no Auth-server round-trip). Middleware already
  // ran the authoritative `getUser()` for this request and redirected away any
  // unauthenticated visitor, so re-validating here only adds latency to the SSR
  // critical path. Reading the JWT claims is enough to resolve role/email and
  // seed the first week — same pattern as `/api/time-tracker`.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;

  if (!claims) redirect("/login");

  // Role lives in app_metadata (service-role writable only), NOT user_metadata,
  // which the user can rewrite themselves via supabase.auth.updateUser. Reading
  // it from user_metadata here let anyone render the HR/admin tab for themselves
  // — harmless on its own because every endpoint behind it re-checks
  // app_metadata, but it disagreed with settings/page.tsx and admin-guard.ts and
  // was a trap for the next data fetch hung off `initialRole`.
  // See SECURITY.md T0.1 and security audit run-3, F7.
  const appMetadata =
    claims.app_metadata && typeof claims.app_metadata === "object" && !Array.isArray(claims.app_metadata)
      ? (claims.app_metadata as Record<string, unknown>)
      : null;
  const userRoleRaw = appMetadata && "role" in appMetadata ? appMetadata.role : null;

  // user_metadata is still the right home for the user's own non-privilege
  // preferences (travel-sheet mapping, signature, appearance) — it is only the
  // ROLE that must never be read from there.
  const userMetadata =
    claims.user_metadata && typeof claims.user_metadata === "object" && !Array.isArray(claims.user_metadata)
      ? (claims.user_metadata as Record<string, unknown>)
      : null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const initialRole = normalizeUserRole(userRoleRaw);
  const isAdmin = isAdminEmail(email);
  const isPilot = initialRole !== "sales" && initialRole !== "hr";
  // A role can only be written by PATCH /api/admin/users, so a brand-new
  // account arrives with none and is held on the "waiting for access" screen
  // below. Admins are exempt: they are the people who assign the role, and
  // locking them out would leave nobody able to fix it.
  const awaitingRole = initialRole == null && !isAdmin;

  // Held accounts get the gate INSTEAD of the shell: none of the prefetches
  // below run, no panel code is sent, and there is nothing to reach behind it.
  // Telling the admins is best-effort and deduped on the server (one mail per
  // account, ever) — it can never throw into this render.
  if (awaitingRole) {
    if (userId && email) {
      await notifyAdminsOfPendingRole({
        userId,
        email,
        name: displayNameFor({ email, user_metadata: userMetadata }),
      });
    }
    return <RoleGate email={email ?? "this account"} />;
  }

  // `?module=` is how an open module survives a reload (the shell keeps it in
  // sync) and how the fleet reminder mails deep-link into the check-in screen.
  // Resolving it here rather than in a mount effect means the requested panel is
  // in the first paint instead of flashing the workspace home first. Unknown
  // values fall through to the home screen; the shell still re-checks the module
  // against the user's role.
  const requestedModuleRaw = (await searchParams).module;
  const requestedModule = isModuleKey(requestedModuleRaw) ? requestedModuleRaw : null;

  // Prefetch each landing/panel's initial data server-side so the panels paint
  // seeded instead of waterfalling client fetches on open. Every prefetch is
  // non-blocking: on failure we log and fall back to the panel's client fetch.
  const weekStartDate = getWeekStartDate();

  const initialWeekPromise: Promise<WeekResponse | null> =
    (initialRole === "sales" || initialRole === "hr") && weekStartDate
      ? fetchCurrentUserWeek(supabase, weekStartDate)
          .then((week) => week as WeekResponse)
          .catch((error) => {
            console.error("Dashboard SSR: fetchCurrentUserWeek failed", error);
            return null;
          })
      : Promise.resolve(null);

  // Settings data is cheap: travel mapping + signature come from the JWT metadata
  // we already have; only the Gmail connection needs a service-role read.
  const initialSettingsPromise: Promise<InitialSettingsData | null> =
    isPilot && userId
      ? fetchInitialSettings(userId, userMetadata).catch((error) => {
          console.error("Dashboard SSR: fetchInitialSettings failed", error);
          return null;
        })
      : Promise.resolve(null);

  // Admin tables (users + current-week overview). Gated on the email-based admin
  // check (equivalent to guardAdmin) before touching the service-role client.
  const adminUsersPromise: Promise<AdminListedUser[] | null> = isAdmin
    ? fetchAdminUsers(createAdminClient()).catch((error) => {
        console.error("Dashboard SSR: fetchAdminUsers failed", error);
        return null;
      })
    : Promise.resolve(null);
  const adminOverviewPromise: Promise<AdminTimeOverview | null> =
    isAdmin && weekStartDate
      ? fetchAdminTimeOverview(createAdminClient(), weekStartDate).catch((error) => {
          console.error("Dashboard SSR: fetchAdminTimeOverview failed", error);
          return null;
        })
      : Promise.resolve(null);

  // Fleet was the one panel that fetched its own board on open, so opening the
  // calendar meant downloading its code and only THEN asking for data — on a
  // fresh function instance that meant a cold start and a first TLS handshake
  // to the database before anything appeared. Prefetching it here rides along
  // with the prefetches above at no extra wall-clock cost, and the panel paints
  // seeded.
  //
  // `autoLink: true` matters: it is the onboarding step that matches a person to
  // their legacy holder name, and it used to run on the panel's own fetch. Now
  // that the panel no longer makes one, this is where it has to happen.
  const initialFleetPromise: Promise<FleetBoardPayload | null> = userId
    ? buildFleetBoard(
        createAdminClient(),
        {
          id: userId,
          email,
          name: displayNameFor({ email, user_metadata: userMetadata }),
          isAdmin,
        },
        { windowDays: DEFAULT_WINDOW_DAYS },
        { autoLink: true },
      ).catch((error) => {
        console.error("Dashboard SSR: buildFleetBoard failed", error);
        return null;
      })
    : Promise.resolve(null);

  // Only what the landing view needs holds the first paint: the week (the
  // Time landing for sales/HR) and the Gmail status (the Mail landing's navbar
  // pill). Fleet and Admin are behind a click, and they are the slow ones —
  // the fleet board runs the holder auto-link and then its own queries, the
  // admin list pages through the Auth admin API — so their promises are handed
  // to the shell unawaited and stream in after the page is already on screen.
  // All of them were started above, so they still run in parallel.
  const [initialWeek, initialSettings] = await Promise.all([initialWeekPromise, initialSettingsPromise]);

  return (
    <DashboardShell
      email={email ?? "Signed in"}
      initialRole={initialRole}
      isAdmin={isAdmin}
      initialWeek={initialWeek}
      initialSettings={initialSettings}
      initialAdminUsers={adminUsersPromise}
      initialAdminOverview={adminOverviewPromise}
      initialFleet={initialFleetPromise}
      initialModule={requestedModule}
    />
  );
}
