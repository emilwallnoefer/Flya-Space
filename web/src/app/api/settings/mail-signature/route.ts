import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeText } from "@/lib/security/input-sanitize";
import { z } from "zod";
import { MAIL_SIGNATURE_DEFAULT_NAME } from "@/lib/mail-signature-presets";
import { forbidHeldAccount } from "@/lib/app-access";

const bodySchema = z.object({
  signature_name: z.string().min(1).max(120),
});

function readNameFromMetadata(rawMetadata: unknown): string {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
    return MAIL_SIGNATURE_DEFAULT_NAME;
  }
  const metadata = rawMetadata as Record<string, unknown>;
  const raw = metadata.mail_signature_name;
  if (typeof raw !== "string" || !raw.trim()) return MAIL_SIGNATURE_DEFAULT_NAME;
  return sanitizeText(raw, { maxLen: 120 }) || MAIL_SIGNATURE_DEFAULT_NAME;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;
  return NextResponse.json({ signature_name: readNameFromMetadata(user.user_metadata) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid signature name." }, { status: 400 });
  }

  const signature_name = sanitizeText(parsed.data.signature_name, { maxLen: 120 });
  if (!signature_name) {
    return NextResponse.json({ error: "Signature name is required." }, { status: 400 });
  }

  const previousMetadata =
    user.user_metadata && typeof user.user_metadata === "object" && !Array.isArray(user.user_metadata)
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  const mergedMetadata = {
    ...previousMetadata,
    mail_signature_name: signature_name,
  };

  const { error } = await supabase.auth.updateUser({ data: mergedMetadata });
  if (error) return NextResponse.json({ error: "Could not save signature name." }, { status: 500 });

  return NextResponse.json({ ok: true, signature_name });
}
