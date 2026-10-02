import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidHeldAccount } from "@/lib/app-access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminEmails } from "@/lib/admin";
import { displayNameFor } from "@/lib/fleet-queries";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import { checkRateLimit, createRateLimitHeaders, getClientIp } from "@/lib/security/rate-limit";
import { sanitizeText } from "@/lib/security/input-sanitize";
import {
  MAX_FIELD_LEN,
  MAX_PARTICIPANTS,
  TRAINING_LOCATIONS,
  TRAINING_PROGRAMMES,
  buildCertificateEmail,
  formatCertificateSummary,
  type CertificateRequestDetails,
  type TrainingLocation,
  type TrainingProgramme,
} from "@/lib/certificate-request";

/**
 * POST /api/chat/certificate-request
 *
 * Any signed-in user may submit. The route is the single writer for
 * `certificate_request` chat rows so three things stay in lockstep:
 *
 *   1. the **trainer** is taken from the session, never from the payload — the
 *      form shows it read-only and a forged body cannot change it;
 *   2. the message **body** is the server-rendered summary, so what the team
 *      sees in chat is byte-identical to what the admins were mailed;
 *   3. the **notification goes to `ADMIN_EMAILS` only**, which is the whole
 *      point of routing this through a server route instead of a plain insert.
 *
 * The insert uses the service-role client: `chat_messages` INSERT is allowed
 * for the author under RLS, but that policy runs against the *browser's*
 * session, which this route does not carry into the DB call. Nothing
 * privileged is written — sender_id is the authenticated user's own id, and
 * the BEFORE INSERT trigger still forces `done_at` / `done_by` to null.
 *
 * Mail delivery is best-effort: a Resend outage must not lose the request, so
 * a failed send is reported back as `notified: false` with the row already
 * persisted, rather than 500-ing after the write.
 */

export const runtime = "nodejs";

const participantSchema = z.object({
  name: z.string().min(1).max(MAX_FIELD_LEN),
  email: z.string().email().max(MAX_FIELD_LEN),
});

// Derived from the shared option lists so a new programme or location can only
// ever be added in one place.
const programmeIds = TRAINING_PROGRAMMES.map((p) => p.id) as [
  TrainingProgramme,
  ...TrainingProgramme[],
];
const locationIds = TRAINING_LOCATIONS.map((l) => l.id) as [
  TrainingLocation,
  ...TrainingLocation[],
];

const bodySchema = z.object({
  customerAccount: z.string().min(1).max(MAX_FIELD_LEN),
  // Calendar date only. A regex alone would also accept "2026-02-31"; the
  // explicit round-trip below rejects impossible days.
  trainingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  programme: z.enum(programmeIds),
  location: z.enum(locationIds),
  participants: z.array(participantSchema).min(1).max(MAX_PARTICIPANTS),
});

const MESSAGE_COLUMNS =
  "id, sender_id, sender_email, body, attachment_path, attachment_name, attachment_type, attachment_size, created_at, kind, done_at, done_by, edited_at";

function isRealCalendarDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const held = forbidHeldAccount(user);
  if (held) return held;

  const limitResult = await checkRateLimit(
    `certificate-request:${user.id}:${getClientIp(request)}`,
    { windowMs: 60 * 60 * 1000, max: 20 },
  );
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Too many certificate requests. Please retry later." },
      { status: 429, headers: createRateLimitHeaders(limitResult) },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
  const payload = parsed.data;
  if (!isRealCalendarDate(payload.trainingDate)) {
    return NextResponse.json({ error: "Training date is not a real date." }, { status: 400 });
  }

  // Every free-text field lands in an HTML email and in a chat bubble, so it
  // goes through the shared sanitizer before it is formatted.
  const details: CertificateRequestDetails = {
    customerAccount: sanitizeText(payload.customerAccount, { maxLen: MAX_FIELD_LEN }),
    trainingDate: payload.trainingDate,
    programme: payload.programme,
    location: payload.location,
    participants: payload.participants.map((p) => ({
      name: sanitizeText(p.name, { maxLen: MAX_FIELD_LEN }),
      email: sanitizeText(p.email, { maxLen: MAX_FIELD_LEN }).toLowerCase(),
    })),
    trainer: {
      // Provider name, never user_metadata (security audit run-4 F7).
      name: displayNameFor({ email: user.email, identities: user.identities }),
      email: user.email,
    },
  };
  if (!details.customerAccount || details.participants.some((p) => !p.name || !p.email)) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("chat_messages")
    .insert({
      sender_id: user.id,
      sender_email: user.email,
      body: formatCertificateSummary(details),
      kind: "certificate_request",
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !message) {
    return NextResponse.json(
      { error: error?.message ?? "Could not save the certificate request." },
      { status: 500 },
    );
  }

  const recipients = getAdminEmails();
  let notified = false;
  if (recipients.length > 0 && isResendConfigured()) {
    const email = buildCertificateEmail(details);
    const results = await Promise.all(
      recipients.map((to) =>
        sendEmailViaResend({ to, subject: email.subject, html: email.html, text: email.text }),
      ),
    );
    notified = results.some((r) => r.ok);
    for (const [i, result] of results.entries()) {
      if (!result.ok) {
        console.error(`certificate-request: mail to ${recipients[i]} failed — ${result.error}`);
      }
    }
  } else {
    console.warn(
      "certificate-request: no admin notification sent (ADMIN_EMAILS empty or Resend unconfigured)",
    );
  }

  return NextResponse.json({ ok: true, message, notified });
}
