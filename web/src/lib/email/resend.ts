import "server-only";

/**
 * Minimal Resend API client. Avoids adding a dependency — Resend's REST
 * surface is small enough that a single `fetch` keeps the bundle tiny and
 * is trivial to swap for another provider if needed.
 *
 * Required env vars:
 *   RESEND_API_KEY   — "re_..." secret from https://resend.com/api-keys
 *   RESEND_FROM      — Verified sender, e.g. "Flya Space <noreply@flya.space>".
 *                      The domain must be verified in Resend first.
 * Optional:
 *   RESEND_REPLY_TO  — Reply-To header (e.g. your HR inbox).
 */

export type SendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isResendConfigured(): boolean {
  return Boolean(readEnv("RESEND_API_KEY") && readEnv("RESEND_FROM"));
}

export async function sendEmailViaResend(
  payload: SendEmailPayload,
): Promise<SendEmailResult> {
  const apiKey = readEnv("RESEND_API_KEY");
  const from = readEnv("RESEND_FROM");
  if (!apiKey || !from) {
    return {
      ok: false,
      error: "Resend is not configured (missing RESEND_API_KEY or RESEND_FROM).",
    };
  }

  const replyTo = readEnv("RESEND_REPLY_TO");

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (error) {
    return { ok: false, error: (error as Error).message || "Network error" };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message ?? "")
        : "") || `Resend responded with HTTP ${response.status}`;
    return { ok: false, error: message };
  }

  const id =
    body && typeof body === "object" && "id" in body
      ? String((body as { id?: unknown }).id ?? "")
      : "";
  return { ok: true, id };
}
