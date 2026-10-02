import { renderBriefMail } from "@/lib/mail-engine";
import { sanitizeNullableText, sanitizeText } from "@/lib/security/input-sanitize";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { MAIL_SIGNATURE_DEFAULT_NAME } from "@/lib/mail-signature-presets";
import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidHeldAccount } from "@/lib/app-access";

/**
 * Re-renders a Brief-mode email with an edited asset selection, WITHOUT calling the LLM.
 * The client sends back the prose it already got from /api/generate-brief plus the new
 * `selected_change_ids`; we run only the deterministic renderer. Cheap and safe — the
 * tracked-link blocks are still rendered from the (validated) IDs by the engine.
 */

const renderSchema = z.object({
  language: z.enum(["en", "de", "fr"]),
  recipient_name: z.string().min(1).max(240),
  signature_name: z.string().max(120).optional(),
  datasets_link: z.string().max(600).optional(),
  prose: z.object({
    subject: z.string().max(400),
    opener: z.string().max(6000),
    recap_intro: z.string().max(4000),
    feedback_ask: z.string().max(2000),
    closing: z.string().max(4000),
  }),
  selected_change_ids: z.array(z.string().min(1).max(80)).max(200),
});

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const limitResult = await checkRateLimit(`render-brief:${clientIp}`, {
    windowMs: 60 * 60 * 1000,
    max: 200,
  });
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limitResult) },
    );
  }

  // Require an authenticated session: this route is only ever called from the
  // signed-in dashboard, so reject anonymous callers to prevent abuse.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  try {
    const parsed = renderSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", detail: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }

    const recipient_name = sanitizeText(parsed.data.recipient_name, { maxLen: 240 });
    const signature_name = sanitizeText(parsed.data.signature_name ?? "", { maxLen: 120 }) || undefined;
    const datasets_link = sanitizeNullableText(parsed.data.datasets_link, { maxLen: 600 });
    const language = parsed.data.language;

    if (!recipient_name) {
      return NextResponse.json({ error: "Missing field: recipient_name" }, { status: 400 });
    }

    const prose = {
      subject: sanitizeText(parsed.data.prose.subject, { maxLen: 400 }),
      opener: sanitizeText(parsed.data.prose.opener, { maxLen: 6000, allowNewlines: true }),
      recap_intro: sanitizeText(parsed.data.prose.recap_intro, { maxLen: 4000, allowNewlines: true }),
      feedback_ask: sanitizeText(parsed.data.prose.feedback_ask, { maxLen: 2000, allowNewlines: true }),
      closing: sanitizeText(parsed.data.prose.closing, { maxLen: 4000, allowNewlines: true }),
    };

    const result = renderBriefMail(
      {
        language,
        recipient_name,
        datasets_link,
        signature_name: signature_name || MAIL_SIGNATURE_DEFAULT_NAME,
      },
      { ...prose, selected_change_ids: parsed.data.selected_change_ids },
    );

    return NextResponse.json({
      ...result,
      selected_change_ids: parsed.data.selected_change_ids,
      brief_content: prose,
    });
  } catch {
    return NextResponse.json({ error: "Failed to render draft." }, { status: 500 });
  }
}
