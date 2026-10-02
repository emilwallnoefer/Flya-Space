import { MailInput, renderMail } from "@/lib/mail-engine";
import { enrichWithAutoResearch } from "@/lib/company-research";
import { sanitizeEmailList, sanitizeNullableText, sanitizeText } from "@/lib/security/input-sanitize";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidHeldAccount } from "@/lib/app-access";

const disciplineSchema = z.enum([
  "intro",
  "aiim_1",
  "aiim_2",
  "ut",
  "tether",
  "surveying",
  "faro_connect",
  "rad_sensor",
  "gas_sensor",
]);

const generateSchema = z.object({
  mail_type: z.enum(["pre", "post"]),
  template_variant: z.enum(["lausanne", "abroad"]).optional(),
  language: z.enum(["en", "de", "fr"]),
  training_type: z.enum(["intro_1day", "aiim_3day"]).optional(),
  recipient_name: z.string().min(1).max(240),
  recipient_optional: z.string().optional(),
  company_name: z.string().optional().default(""),
  use_case: z.string().optional(),
  date: z.string().optional().default(""),
  location: z.string().optional().default(""),
  day_count: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  day1_disciplines: z.array(disciplineSchema).max(8).optional(),
  day2_disciplines: z.array(disciplineSchema).max(8).optional(),
  day3_disciplines: z.array(disciplineSchema).max(8).optional(),
  day1_site: z.enum(["tridel", "tank_bern", "aigle_bridge", "montetan", "bunker"]).optional(),
  day2_site: z.enum(["tridel", "tank_bern", "aigle_bridge", "montetan", "bunker"]).optional(),
  day3_site: z.enum(["tridel", "tank_bern", "aigle_bridge", "montetan", "bunker"]).optional(),
  custom_opener_note: z.string().optional(),
  industry_course_ids: z.string().optional(),
  include_certification_note: z.boolean().optional(),
  include_simulator_note: z.boolean().optional(),
  datasets_link: z.string().optional(),
  include_customer_toolkit: z.boolean().optional(),
  company_research_text: z.string().optional(),
  included_change_ids: z.array(z.string().min(1).max(80)).max(200).optional(),
  signature_name: z.string().max(120).optional(),
});

function sanitizeMailPayload(input: z.infer<typeof generateSchema>): MailInput {
  return {
    ...input,
    recipient_name: sanitizeText(input.recipient_name, { maxLen: 240 }),
    recipient_optional: sanitizeEmailList(input.recipient_optional, 500),
    company_name: sanitizeText(input.company_name, { maxLen: 240 }),
    use_case: sanitizeNullableText(input.use_case, { maxLen: 500 }),
    date: sanitizeText(input.date, { maxLen: 80 }),
    location: sanitizeText(input.location, { maxLen: 180 }),
    custom_opener_note: sanitizeNullableText(input.custom_opener_note, { maxLen: 1200, allowNewlines: true }),
    industry_course_ids: sanitizeNullableText(input.industry_course_ids, { maxLen: 1000 }),
    datasets_link: sanitizeNullableText(input.datasets_link, { maxLen: 600 }),
    company_research_text: sanitizeNullableText(input.company_research_text, { maxLen: 4000, allowNewlines: true }),
    included_change_ids: input.included_change_ids?.map((id) => sanitizeText(id, { maxLen: 80 })).filter(Boolean),
    signature_name: sanitizeText(input.signature_name, { maxLen: 120 }) || undefined,
  };
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const limitResult = await checkRateLimit(`generate:${clientIp}`, {
    windowMs: 60 * 60 * 1000,
    max: 100,
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
    const rawPayload = await request.json();
    const parsedPayload = generateSchema.safeParse(rawPayload);
    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "Invalid request payload", detail: parsedPayload.error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }
    const payload = sanitizeMailPayload(parsedPayload.data);

    const requiredBase: Array<keyof MailInput> = ["mail_type", "language", "recipient_name"];
    const requiredPost: Array<keyof MailInput> = ["training_type", "company_name", "use_case"];
    const requiredPreBase: Array<keyof MailInput> = ["template_variant", "day_count", "date"];
    // Lausanne flight site is optional; abroad still needs a location.
    const requiredPre: Array<keyof MailInput> =
      payload.template_variant === "abroad" ? [...requiredPreBase, "location"] : requiredPreBase;
    const required = payload.mail_type === "pre" ? [...requiredBase, ...requiredPre] : [...requiredBase, ...requiredPost];

    const missing = required.filter((field) => !payload[field]);
    if (missing.length) {
      return NextResponse.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const enrichedPayload = await enrichWithAutoResearch(payload);
    const result = renderMail(enrichedPayload);
    return NextResponse.json({
      ...result,
      selected_change_ids: enrichedPayload.included_change_ids ?? [],
    });
  } catch {
    return NextResponse.json({ error: "Failed to generate draft." }, { status: 500 });
  }
}
