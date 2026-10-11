import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { forbidHeldAccount } from "@/lib/app-access";
import { displayNameFor } from "@/lib/fleet-queries";
import { notifyAdminsOfPhoneTourCompletion } from "@/lib/phone-tour-notice";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";

/**
 * POST — the signed-in person pressed Done on the last step of the phone
 * walkthrough (components/phone-tour.tsx). Tells the admins once per person;
 * see lib/phone-tour-notice.ts. The name comes from the sign-in provider via
 * `displayNameFor()`, never from user-writable metadata.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const limit = await checkRateLimit(`phone-tour-complete:${user.id}:${getClientIp(request)}`, {
    windowMs: 60 * 60 * 1000,
    max: 10,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Please retry later." }, { status: 429, headers: createRateLimitHeaders(limit) });
  }

  const outcome = await notifyAdminsOfPhoneTourCompletion({
    userId: user.id,
    email: user.email ?? "",
    name: displayNameFor({ email: user.email, identities: user.identities }),
  });
  return NextResponse.json({ outcome });
}
