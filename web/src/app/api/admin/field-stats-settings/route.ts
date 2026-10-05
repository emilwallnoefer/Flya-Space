import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { readGmailConnection } from "@/lib/gmail-tokens";
import { getFieldStats, readFieldStatsSettings, writeFieldStatsSettings } from "@/lib/field-stats-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function describe(adminUserId: string) {
  const settings = await readFieldStatsSettings();
  const [source, mine, stats] = await Promise.all([
    settings.token_user_id ? readGmailConnection(settings.token_user_id) : Promise.resolve(null),
    readGmailConnection(adminUserId),
    getFieldStats(),
  ]);
  return {
    sales_regions: settings.sales_regions,
    updated_at: settings.updated_at,
    updated_by: settings.updated_by,
    source: settings.token_user_id
      ? {
          is_me: settings.token_user_id === adminUserId,
          connected: Boolean(source),
          google_email: source?.gmailEmail ?? null,
        }
      : null,
    my_connection: mine ? { google_email: mine.gmailEmail } : null,
    // Every salesperson the sheet names, so none is left out of the map.
    sales_names: stats.ok ? stats.stats.salesNames : [],
    sheet_error: stats.ok ? null : stats.hint,
  };
}

export async function GET() {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json(await describe(guard.user.id));
}

const patchSchema = z
  .object({
    // Only ever the acting admin's own connection: nobody can point the sheet
    // read at somebody else's Google account.
    use_my_connection: z.literal(true).optional(),
    sales_regions: z.record(z.string().trim().min(1).max(80), z.string().trim().max(80)).optional(),
  })
  .refine((body) => body.use_my_connection !== undefined || body.sales_regions !== undefined, {
    message: "No settings to update.",
  });

export async function PATCH(request: Request) {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  if (parsed.data.use_my_connection && !(await readGmailConnection(guard.user.id))) {
    return NextResponse.json(
      { error: "Connect your Google account in Settings first, then try again." },
      { status: 409 },
    );
  }

  try {
    await writeFieldStatsSettings(
      {
        ...(parsed.data.use_my_connection ? { token_user_id: guard.user.id } : {}),
        ...(parsed.data.sales_regions ? { sales_regions: parsed.data.sales_regions } : {}),
      },
      guard.user.email,
    );
  } catch (error) {
    console.error("[field-stats] settings write failed", (error as Error).message);
    return NextResponse.json(
      { error: "Could not save. Has supabase/2026-10-05-field-stats-settings.sql been applied?" },
      { status: 500 },
    );
  }

  await recordAdminAudit(createAdminClient(), {
    actor_email: guard.user.email,
    action: "field_stats_settings_change",
    detail: {
      ...(parsed.data.use_my_connection ? { source: guard.user.email } : {}),
      ...(parsed.data.sales_regions ? { sales_regions: parsed.data.sales_regions } : {}),
    },
  });

  return NextResponse.json(await describe(guard.user.id));
}
