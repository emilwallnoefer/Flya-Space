import { readGmailRefreshToken } from "@/lib/gmail-tokens";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { forbidHeldAccount } from "@/lib/app-access";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ connected: false }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const metadata = user.user_metadata ?? {};
  const refreshToken = await readGmailRefreshToken(user.id);
  return NextResponse.json({
    connected: Boolean(refreshToken),
    gmail_email: metadata.gmail_email ?? null,
  });
}
