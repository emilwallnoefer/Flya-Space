import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { forbidHeldAccount, hasAppAccess } from "@/lib/app-access";
import { displayNameFor } from "@/lib/fleet-queries";
import type { ChatMember } from "@/lib/chat-mentions";

/**
 * GET /api/chat/members — the people who can be @-mentioned in Team chat:
 * every account with a role, as `{ id, name, email }`, sorted by name.
 *
 * Any role holder may call it (the chat already shows every sender's email
 * and who is online). Names come from the sign-in provider through
 * `displayNameFor()`, never from user-writable metadata, so a mention names
 * the person the account belongs to. Held accounts are left out: they have no
 * chat to be mentioned in.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const admin = createAdminClient();
  const members: ChatMember[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return NextResponse.json({ error: "Could not load the team." }, { status: 500 });
    for (const account of data.users) {
      if (!account.email || !hasAppAccess(account)) continue;
      members.push({
        id: account.id,
        name: displayNameFor({ email: account.email, identities: account.identities }),
        email: account.email,
      });
    }
    if (data.users.length < perPage) break;
  }
  members.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json(
    { members },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
