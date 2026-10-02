import { deleteGmailToken } from "@/lib/gmail-tokens";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { forbidHeldAccount } from "@/lib/app-access";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  // Remove the server-side refresh token first, then clear display metadata.
  await deleteGmailToken(user.id);

  const { error } = await supabase.auth.updateUser({
    data: {
      gmail_refresh_token: null,
      gmail_email: null,
    },
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
