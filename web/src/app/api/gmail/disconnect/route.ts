import { deleteGmailToken, readGmailRefreshToken } from "@/lib/gmail-tokens";
import { revokeGoogleRefreshToken } from "@/lib/gmail";
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

  // Revoke the grant at Google, then remove the server-side refresh token,
  // then clear display metadata.
  const refreshToken = await readGmailRefreshToken(user.id);
  if (refreshToken) await revokeGoogleRefreshToken(refreshToken);
  await deleteGmailToken(user.id);

  const { error } = await supabase.auth.updateUser({
    data: {
      gmail_refresh_token: null,
      gmail_email: null,
    },
  });
  if (error) {
    console.error("[gmail/disconnect] metadata clear failed", error.message);
    return NextResponse.json({ ok: false, error: "Could not finish disconnecting. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
