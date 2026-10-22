import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAdminUsers } from "@/lib/admin-queries";
import { normalizeUserRole } from "@/lib/user-role";
import { recordAdminAudit } from "@/lib/admin-audit";
import { readModuleGrants, withModuleGrant } from "@/lib/role-access";

export async function GET() {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;

  const admin = createAdminClient();
  try {
    const users = await fetchAdminUsers(admin);
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// One change per request: the role, or the Time Tracker switch (a module
// granted beyond the role, lib/role-access.ts). Both live in app_metadata.
const patchBodySchema = z
  .object({
    user_id: z.string().uuid(),
    role: z
      .union([z.literal("sales"), z.literal("eu_pilot"), z.literal("us_pilot"), z.literal("hr"), z.null()])
      .optional(),
    time_access: z.boolean().optional(),
  })
  .refine((body) => (body.role !== undefined) !== (body.time_access !== undefined), {
    message: "Send either role or time_access.",
  });

export async function PATCH(request: Request) {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;

  const parsed = patchBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const { user_id, role, time_access } = parsed.data;

  const admin = createAdminClient();
  const current = await admin.auth.admin.getUserById(user_id);
  if (current.error || !current.data?.user) {
    return NextResponse.json({ error: current.error?.message ?? "User not found" }, { status: 404 });
  }
  // Role lives in app_metadata, which is writable only via the service-role key
  // (users cannot rewrite it themselves via updateUser). See SECURITY.md T0.1.
  const existingAppMetadata =
    current.data.user.app_metadata && typeof current.data.user.app_metadata === "object"
      ? (current.data.user.app_metadata as Record<string, unknown>)
      : {};
  const previousRole = normalizeUserRole(existingAppMetadata.role);
  const previousTimeAccess = readModuleGrants(existingAppMetadata).includes("time");

  const nextAppMetadata =
    role !== undefined
      ? { ...existingAppMetadata, role }
      : { ...existingAppMetadata, module_grants: withModuleGrant(existingAppMetadata, "time", time_access === true) };

  const updateRes = await admin.auth.admin.updateUserById(user_id, {
    app_metadata: nextAppMetadata,
  });
  if (updateRes.error) {
    return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
  }

  // Record the change in the admin audit trail (best-effort; never blocks).
  if (time_access !== undefined && previousTimeAccess !== time_access) {
    await recordAdminAudit(admin, {
      actor_email: guard.user.email,
      action: "module_grant_change",
      target: current.data.user.email ?? user_id,
      detail: { module: "time", from: previousTimeAccess, to: time_access },
    });
  }
  if (role !== undefined && previousRole !== role) {
    await recordAdminAudit(admin, {
      actor_email: guard.user.email,
      action: "role_change",
      target: current.data.user.email ?? user_id,
      detail: { from: previousRole, to: role },
    });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: updateRes.data.user?.id ?? user_id,
      email: updateRes.data.user?.email ?? "",
      role: role !== undefined ? role : previousRole,
      time_access: readModuleGrants(updateRes.data.user?.app_metadata ?? nextAppMetadata).includes("time"),
    },
  });
}
