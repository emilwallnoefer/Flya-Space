import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { displayNameFor, recordAssetEvent } from "@/lib/fleet-queries";
import { normalizeHolderLabel } from "@/lib/fleet-rules";
import { reassignEventNote, releaseEventNote } from "@/lib/fleet-holder-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin → Holder claims.
 *
 * Claiming a free-text fleet holder name is deliberately permissive (see
 * `app/api/fleet/handlers/claim-holder.ts`): the material was imported from a
 * spreadsheet that spelled people inconsistently, so a strict name match would
 * block the very people the flow exists to onboard. This route is the other
 * half of that trade — it makes every claim visible, and every wrong one
 * fixable, without narrowing who may claim.
 *
 * GET lists the claims with the material behind each one; POST reassigns a
 * label to a different account, or releases it back to unclaimed.
 *
 * `fleet_holder_aliases` grants nothing to `authenticated` (see
 * `supabase/2026-09-15-fleet-claim-oversight.sql`), so this route and
 * `/api/fleet` are the only readers. `guardAdmin()` runs before the
 * service-role client is created, in every handler.
 */

type Person = { id: string; email: string | null; name: string };

type AliasRow = {
  label: string;
  user_id: string;
  claimed_at: string | null;
  claimed_by: string | null;
  self_match: boolean | null;
  claimed_label: string | null;
  reassigned_by: string | null;
  reassigned_at: string | null;
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Everyone with an account, by id.
 *
 * Read in one pass rather than per row: the alias table names a holder and a
 * claimant, the dropdown needs the whole directory anyway, and a per-row
 * `getUserById` would be a round trip per claim.
 */
async function loadDirectory(admin: Admin): Promise<Map<string, Person>> {
  const people = new Map<string, Person>();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    for (const user of users) {
      people.set(user.id, {
        id: user.id,
        email: user.email ?? null,
        name: displayNameFor({ email: user.email, identities: user.identities }),
      });
    }
    if (users.length < 200) break;
    page += 1;
    if (page > 50) break;
  }
  return people;
}

/**
 * Every reservation and asset that carries a holder label, bucketed by the
 * NORMALISED label.
 *
 * Grouped in JS for the same reason the claim handler matches in JS:
 * normalisation (case, accents, punctuation) lives in `fleet-rules` and must
 * not be reimplemented in Postgres, or the two would drift and material would
 * move for one and not the other.
 */
async function loadMaterialByLabel(admin: Admin): Promise<{
  reservations: Map<string, Array<{ id: string; asset_id: string; user_id: string | null }>>;
  assets: Map<string, Array<{ id: string; name: string | null }>>;
}> {
  const reservations = new Map<string, Array<{ id: string; asset_id: string; user_id: string | null }>>();
  const assets = new Map<string, Array<{ id: string; name: string | null }>>();

  const { data: resRows, error: resError } = await admin
    .from("fleet_reservations")
    .select("id, asset_id, user_id, holder_label")
    .not("holder_label", "is", null);
  if (resError) throw new Error(resError.message);
  for (const row of resRows ?? []) {
    const key = normalizeHolderLabel(row.holder_label as string);
    if (!key) continue;
    const list = reservations.get(key) ?? [];
    list.push({ id: row.id as string, asset_id: row.asset_id as string, user_id: row.user_id as string | null });
    reservations.set(key, list);
  }

  const { data: assetRows, error: assetError } = await admin
    .from("fleet_assets")
    .select("id, name, current_holder_label")
    .not("current_holder_label", "is", null);
  if (assetError) throw new Error(assetError.message);
  for (const row of assetRows ?? []) {
    const key = normalizeHolderLabel(row.current_holder_label as string);
    if (!key) continue;
    const list = assets.get(key) ?? [];
    list.push({ id: row.id as string, name: (row.name as string | null) ?? null });
    assets.set(key, list);
  }

  return { reservations, assets };
}

export async function GET() {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;

  const admin = createAdminClient();
  try {
    const { data: aliases, error } = await admin
      .from("fleet_holder_aliases")
      .select("label, user_id, claimed_at, claimed_by, self_match, claimed_label, reassigned_by, reassigned_at")
      .order("claimed_at", { ascending: false });
    if (error) throw new Error(error.message);

    const [directory, material] = await Promise.all([loadDirectory(admin), loadMaterialByLabel(admin)]);

    const claims = ((aliases as AliasRow[] | null) ?? []).map((row) => ({
      label: row.label,
      // What a human typed, when we have it. Rows claimed before
      // 2026-09-15 only ever kept the normalised form.
      claimed_label: row.claimed_label ?? row.label,
      holder: directory.get(row.user_id) ?? null,
      claimed_by: row.claimed_by ? (directory.get(row.claimed_by) ?? null) : null,
      claimed_at: row.claimed_at,
      // Historical rows predate the column and default to true, which is
      // accurate: every writer before this existed derived the label from the
      // person themselves.
      self_match: row.self_match !== false,
      reassigned_by: row.reassigned_by ? (directory.get(row.reassigned_by) ?? null) : null,
      reassigned_at: row.reassigned_at,
      material: {
        bookings: material.reservations.get(row.label)?.length ?? 0,
        assets: material.assets.get(row.label)?.length ?? 0,
      },
    }));

    // The reassign dropdown needs the whole directory, not just people who
    // already hold a label — the point is to move material to someone who
    // does not.
    const users = [...directory.values()].sort((a, b) =>
      (a.email ?? a.name).localeCompare(b.email ?? b.name),
    );

    return NextResponse.json({ claims, users });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reassign"),
    label: z.string().trim().min(1).max(160),
    user_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("release"),
    label: z.string().trim().min(1).max(160),
  }),
]);

export async function POST(request: Request) {
  const guard = await guardAdmin();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const body = parsed.data;
  const label = normalizeHolderLabel(body.label);
  if (!label) {
    return NextResponse.json({ error: "That name is empty." }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    const { data: alias, error: aliasError } = await admin
      .from("fleet_holder_aliases")
      .select("label, user_id, claimed_label")
      .eq("label", label)
      .maybeSingle();
    if (aliasError) throw new Error(aliasError.message);
    if (!alias) {
      return NextResponse.json({ error: "That name is not claimed." }, { status: 404 });
    }

    const material = await loadMaterialByLabel(admin);
    const reservations = material.reservations.get(label) ?? [];
    const assets = material.assets.get(label) ?? [];
    const spelling = (alias.claimed_label as string | null) ?? label;

    if (body.action === "reassign") {
      const directory = await loadDirectory(admin);
      const target = directory.get(body.user_id);
      if (!target) {
        return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
      }

      // The material follows the name, exactly as it did on the claim. Leaving
      // it pointed at the wrong person would make the alias a label with no
      // consequences — and would keep mailing return reminders to somebody who
      // never had the kit.
      await moveHolder(admin, { reservations, assets, userId: target.id });

      const { error: updateError } = await admin
        .from("fleet_holder_aliases")
        .update({
          user_id: target.id,
          // The correction is by definition the right answer, so it is not a
          // mismatch to report; `reassigned_by` is what tells the table this
          // row was fixed rather than claimed.
          self_match: true,
          reassigned_by: guard.user.id,
          reassigned_at: new Date().toISOString(),
        })
        .eq("label", label);
      if (updateError) throw new Error(updateError.message);

      const note = reassignEventNote({ label: spelling, to: target, by: guard.user.email });
      await noteOnAssets(admin, { reservations, assets, note, actor: guard.user.id });

      await recordAdminAudit(admin, {
        actor_email: guard.user.email,
        action: "fleet_holder_reassign",
        target: label,
        detail: {
          from_user_id: alias.user_id,
          to_user_id: target.id,
          to_email: target.email,
          bookings: reservations.length,
          assets: assets.length,
        },
      });

      return NextResponse.json({
        ok: true,
        message: `"${spelling}" now belongs to ${target.name}.`,
      });
    }

    // Release: back to exactly the pre-claim state — the label stays on the
    // rows, the account pointer comes off. A booking with a null `user_id` is
    // unclaimed by definition and can never trigger a return reminder, which is
    // the invariant that keeps reminders off people who do not hold anything.
    await moveHolder(admin, { reservations, assets, userId: null });

    const { error: deleteError } = await admin
      .from("fleet_holder_aliases")
      .delete()
      .eq("label", label);
    if (deleteError) throw new Error(deleteError.message);

    const note = releaseEventNote({ label: spelling, by: guard.user.email });
    await noteOnAssets(admin, { reservations, assets, note, actor: guard.user.id });

    await recordAdminAudit(admin, {
      actor_email: guard.user.email,
      action: "fleet_holder_release",
      target: label,
      detail: {
        from_user_id: alias.user_id,
        bookings: reservations.length,
        assets: assets.length,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `"${spelling}" is unclaimed again. Its material is back to a name with no account behind it.`,
    });
  } catch (error) {
    console.error("POST /api/admin/fleet-holder-claims failed", error);
    return NextResponse.json({ error: "Could not update that claim." }, { status: 500 });
  }
}

/** Repoints every booking and every assigned unit under a label at one account (or none). */
async function moveHolder(
  admin: Admin,
  params: {
    reservations: Array<{ id: string; asset_id: string }>;
    assets: Array<{ id: string }>;
    userId: string | null;
  },
) {
  if (params.reservations.length > 0) {
    const { error } = await admin
      .from("fleet_reservations")
      .update({ user_id: params.userId })
      .in(
        "id",
        params.reservations.map((row) => row.id),
      );
    if (error) throw new Error(error.message);

    // The asset's own holder pointer follows its booking, the same pairing the
    // claim makes — an asset that is physically out has a holder.
    const { error: assetError } = await admin
      .from("fleet_assets")
      .update({ current_holder_user_id: params.userId })
      .in(
        "id",
        params.reservations.map((row) => row.asset_id),
      )
      .eq("status", "out");
    if (assetError) throw new Error(assetError.message);
  }

  if (params.assets.length > 0) {
    const { error } = await admin
      .from("fleet_assets")
      .update({ current_holder_user_id: params.userId })
      .in(
        "id",
        params.assets.map((row) => row.id),
      );
    if (error) throw new Error(error.message);
  }
}

/**
 * Writes the correction into each affected asset's history.
 *
 * Best-effort by way of `recordAssetEvent`, which logs and swallows: the
 * material has already moved, and a failed history row must not leave it half
 * moved.
 */
async function noteOnAssets(
  admin: Admin,
  params: {
    reservations: Array<{ id: string; asset_id: string }>;
    assets: Array<{ id: string }>;
    note: string;
    actor: string;
  },
) {
  for (const row of params.reservations) {
    await recordAssetEvent(admin, {
      asset_id: row.asset_id,
      reservation_id: row.id,
      kind: "note",
      actor_user_id: params.actor,
      note: params.note,
    });
  }
  const covered = new Set(params.reservations.map((row) => row.asset_id));
  for (const row of params.assets) {
    if (covered.has(row.id)) continue;
    await recordAssetEvent(admin, {
      asset_id: row.id,
      kind: "note",
      actor_user_id: params.actor,
      note: params.note,
    });
  }
}
