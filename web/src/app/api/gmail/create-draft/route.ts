import { createGmailDraft } from "@/lib/gmail";
import { readGmailRefreshToken } from "@/lib/gmail-tokens";
import { rewriteHtmlForTracking, resolveTrackingBaseUrl } from "@/lib/email/link-tracker";
import {
  sanitizeEmailList,
  sanitizeMailHtml,
  sanitizeNullableText,
  sanitizeText,
} from "@/lib/security/input-sanitize";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidHeldAccount } from "@/lib/app-access";

type TrackingMeta = {
  recipient_name: string;
  recipient_email?: string;
  company_name?: string;
  mail_type: string;
  language?: string;
  template_variant?: string;
  training_type?: string;
};

type RequestPayload = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html_body?: string;
  inline_attachments?: Array<{ contentId: string; mimeType: string; base64: string }>;
  tracking_meta?: TrackingMeta;
};

const inlineAttachmentSchema = z.object({
  contentId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),
  mimeType: z.string().min(1).max(80),
  base64: z.string().min(1).max(800_000),
});

const trackingMetaSchema = z.object({
  recipient_name: z.string().min(1).max(240),
  recipient_email: z.string().max(500).optional(),
  company_name: z.string().max(240).optional(),
  mail_type: z.string().min(1).max(40),
  language: z.string().max(8).optional(),
  template_variant: z.string().max(40).optional(),
  training_type: z.string().max(40).optional(),
});

const draftPayloadSchema = z.object({
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(30000),
  html_body: z.string().max(60000).optional(),
  inline_attachments: z.array(inlineAttachmentSchema).max(3).optional(),
  tracking_meta: trackingMetaSchema.optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const held = forbidHeldAccount(user);
  if (held) return held;

  const clientIp = getClientIp(request);
  const limitResult = await checkRateLimit(`gmail-draft:${user.id}:${clientIp}`, {
    windowMs: 60 * 60 * 1000,
    max: 80,
  });
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limitResult) },
    );
  }

  const parsedPayload = draftPayloadSchema.safeParse(await request.json());
  if (!parsedPayload.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const trackingMeta: TrackingMeta | undefined = parsedPayload.data.tracking_meta
    ? {
        recipient_name: sanitizeText(parsedPayload.data.tracking_meta.recipient_name, { maxLen: 240 }),
        recipient_email: sanitizeEmailList(parsedPayload.data.tracking_meta.recipient_email, 500),
        company_name: sanitizeText(parsedPayload.data.tracking_meta.company_name, { maxLen: 240 }),
        mail_type: sanitizeText(parsedPayload.data.tracking_meta.mail_type, { maxLen: 40 }),
        language: sanitizeNullableText(parsedPayload.data.tracking_meta.language, { maxLen: 8 }),
        template_variant: sanitizeNullableText(parsedPayload.data.tracking_meta.template_variant, { maxLen: 40 }),
        training_type: sanitizeNullableText(parsedPayload.data.tracking_meta.training_type, { maxLen: 40 }),
      }
    : undefined;

  const payload: RequestPayload = {
    to: sanitizeEmailList(parsedPayload.data.to, 500),
    cc: sanitizeEmailList(parsedPayload.data.cc, 500),
    bcc: sanitizeEmailList(parsedPayload.data.bcc, 500),
    subject: sanitizeText(parsedPayload.data.subject, { maxLen: 300 }),
    body: sanitizeText(parsedPayload.data.body, { maxLen: 30000, allowNewlines: true }),
    // Every other field here is sanitized; html_body used to be the one that
    // wasn't (security audit run-3, F6). It carries active-content constructs
    // the mail renderer never emits, so strip them before the body is
    // base64-encoded into the MIME part.
    html_body: sanitizeMailHtml(parsedPayload.data.html_body),
    inline_attachments: parsedPayload.data.inline_attachments,
    tracking_meta: trackingMeta,
  };
  if (!payload.subject || !payload.body) {
    return NextResponse.json({ error: "Missing required fields: subject, body" }, { status: 400 });
  }

  const refreshToken = await readGmailRefreshToken(user.id);
  if (!refreshToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 400 });

  // Insert tracking send + rewrite outbound HTML links so each becomes
  // a /r/<id> redirect. Tracking failures must never block the send: if
  // anything goes wrong we fall back to the original HTML.
  let htmlForGmail = payload.html_body;
  if (trackingMeta && payload.html_body) {
    try {
      const admin = createAdminClient();
      const { data: insertedSend, error: sendErr } = await admin
        .from("mail_sends")
        .insert({
          user_id: user.id,
          recipient_name: trackingMeta.recipient_name,
          recipient_email: trackingMeta.recipient_email || null,
          company_name: trackingMeta.company_name || null,
          subject: payload.subject,
          mail_type: trackingMeta.mail_type,
          language: trackingMeta.language || null,
          template_variant: trackingMeta.template_variant || null,
          training_type: trackingMeta.training_type || null,
        })
        .select("id")
        .single();
      if (sendErr || !insertedSend) {
        throw new Error(sendErr?.message || "Failed to create mail_sends row");
      }
      const baseUrl = resolveTrackingBaseUrl(request);
      const result = await rewriteHtmlForTracking(payload.html_body, insertedSend.id, baseUrl, admin);
      htmlForGmail = result.html;
    } catch {
      htmlForGmail = payload.html_body;
    }
  }

  try {
    const result = await createGmailDraft(refreshToken, {
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      body: payload.body,
      html_body: htmlForGmail,
      inline_attachments: payload.inline_attachments?.map((a) => ({
        contentId: a.contentId,
        mimeType: a.mimeType,
        base64: a.base64.replace(/\s+/g, ""),
      })),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to create Gmail draft." }, { status: 500 });
  }
}
