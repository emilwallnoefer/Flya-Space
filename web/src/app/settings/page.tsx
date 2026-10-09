import { SettingsShell } from "@/components/settings-shell";
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from "@/components/settings/types";
import { normalizeUserRole } from "@/lib/user-role";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAdminEmail } from "@/lib/admin";
import { isPhoneRequest } from "@/lib/device";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Role lives in app_metadata (service-role writable only), not user_metadata.
  // See SECURITY.md T0.1.
  const userRoleRaw =
    user.app_metadata &&
    typeof user.app_metadata === "object" &&
    !Array.isArray(user.app_metadata) &&
    "role" in user.app_metadata
      ? (user.app_metadata as Record<string, unknown>).role
      : null;
  const userRole = normalizeUserRole(userRoleRaw);

  // An account with no role is held on the gate at /dashboard until an admin
  // assigns one. Settings is a module like any other, so it must not be a way
  // around that. Admins are exempt — they are the ones who lift the hold.
  if (userRole == null && !isAdminEmail(user.email)) redirect("/dashboard");

  // The panel keeps `?section=` in sync, so a reload reopens the same section.
  // It is resolved here rather than on mount because this page is server
  // rendered: reading the URL during the client's first render would not match.
  const requestedSectionRaw = (await searchParams).section;
  const initialSection =
    typeof requestedSectionRaw === "string" &&
    SETTINGS_SECTION_IDS.includes(requestedSectionRaw as SettingsSectionId)
      ? (requestedSectionRaw as SettingsSectionId)
      : null;

  // Phones: Settings lives inside the mobile shell (components/mobile/),
  // which the dashboard renders for them.
  if (isPhoneRequest(await headers())) {
    redirect(initialSection ? `/dashboard?module=settings&section=${initialSection}` : "/dashboard?module=settings");
  }

  return (
    <SettingsShell email={user.email ?? "Signed in"} userRole={userRole} initialSection={initialSection} />
  );
}
