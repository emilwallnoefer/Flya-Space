import { generateBriefDraft } from "@/lib/mail-brief-llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readWorkspaceSettings } from "@/lib/workspace-settings";
import { recipientCount, renderBriefMail } from "@/lib/mail-engine";
import { sanitizeNullableText, sanitizeText } from "@/lib/security/input-sanitize";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { MAIL_SIGNATURE_DEFAULT_NAME } from "@/lib/mail-signature-presets";
import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidHeldAccount } from "@/lib/app-access";

/**
 * Brief mode endpoint. Mirrors /api/generate but generates the email with Claude (Opus 4.8)
 * from a free-text brief, then renders the tracked-link blocks deterministically via
 * `renderBriefMail`. The structured /api/generate path is left untouched.
 */

const briefSchema = z.object({
  language: z.enum(["en", "de", "fr"]),
  recipient_name: z.string().min(1).max(240),
  brief: z.string().min(1).max(4000),
  signature_name: z.string().max(120).optional(),
  datasets_link: z.string().max(600).optional(),
});

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  // Pre-auth flood guard per IP. It is looser than the per-user budget below
  // because the whole office shares one IP.
  const limitResult = await checkRateLimit(`generate-brief:${clientIp}`, {
    windowMs: 60 * 60 * 1000,
    max: 120,
  });
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limitResult) },
    );
  }

  // Require an authenticated session before spending on the paid LLM: this
  // route is only ever called from the signed-in dashboard. The admin client
  // below is still used only for the non-sensitive workspace-settings read.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  // Brief mode calls a paid LLM, so each person gets a budget of their own,
  // tighter than the deterministic generator.
  const userLimit = await checkRateLimit(`generate-brief-user:${user.id}`, {
    windowMs: 60 * 60 * 1000,
    max: 40,
  });
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(userLimit) },
    );
  }

  try {
    const rawPayload = await request.json();
    const parsed = briefSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", detail: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }

    const recipient_name = sanitizeText(parsed.data.recipient_name, { maxLen: 240 });
    const brief = sanitizeText(parsed.data.brief, { maxLen: 4000, allowNewlines: true });
    const signature_name = sanitizeText(parsed.data.signature_name ?? "", { maxLen: 120 }) || undefined;
    const datasets_link = sanitizeNullableText(parsed.data.datasets_link, { maxLen: 600 });
    const language = parsed.data.language;

    if (!recipient_name || !brief) {
      return NextResponse.json({ error: "Missing fields: recipient_name, brief" }, { status: 400 });
    }

    const hasDatasetsLink = /^https?:\/\//i.test((datasets_link ?? "").trim());

    // Read the admin-selected model (workspace-wide config). Non-sensitive read via the
    // service key, same pattern the reminder cron uses; falls back to env/default on error.
    let configuredModel: string | null = null;
    try {
      configuredModel = (await readWorkspaceSettings(createAdminClient())).mail_brief_model;
    } catch {
      /* keep default */
    }

    const llm = await generateBriefDraft({
      language,
      recipient_name,
      brief,
      recipient_count: recipientCount(recipient_name),
      has_datasets_link: hasDatasetsLink,
      model: configuredModel,
    });

    const result = renderBriefMail(
      {
        language,
        recipient_name,
        datasets_link,
        signature_name: signature_name || MAIL_SIGNATURE_DEFAULT_NAME,
      },
      llm,
    );

    return NextResponse.json({
      ...result,
      selected_change_ids: llm.selected_change_ids,
      // The LLM prose, so the client can re-render with edited assets without another LLM call.
      brief_content: {
        subject: llm.subject,
        opener: llm.opener,
        recap_intro: llm.recap_intro,
        feedback_ask: llm.feedback_ask,
        closing: llm.closing,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate draft.";
    // Surface config/refusal messages (they're actionable); keep everything else generic.
    const isActionable = /ANTHROPIC_API_KEY|declined|revise|malformed|try again|too long|shorten/i.test(message);
    return NextResponse.json(
      { error: isActionable ? message : "Failed to generate draft." },
      { status: 500 },
    );
  }
}
