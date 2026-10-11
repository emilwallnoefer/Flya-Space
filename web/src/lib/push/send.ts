import "server-only";

import webpush from "web-push";

/**
 * Web Push, server side. One function: deliver a small JSON payload to one
 * device. The browser's push service (Apple's, Google's, Mozilla's) does the
 * waking-up and the showing; `public/sw.js` turns the payload into the
 * notification the user sees.
 *
 * Env:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — the public half of the VAPID key pair, also
 *                                  handed to the browser at subscribe time so
 *                                  the push service can tie the device to us.
 *   VAPID_PRIVATE_KEY            — server-only; signs each request (RFC 8292).
 *   VAPID_SUBJECT                — `mailto:` address the push service may use
 *                                  to reach us; defaults to the Resend From.
 *
 * Generate a pair once with `npx web-push generate-vapid-keys`. Rotating it
 * invalidates every existing subscription (the push services pin the key), so
 * users would have to switch notifications on again.
 */

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  /** Where a tap lands. Same-origin path, e.g. `/dashboard?module=time`. */
  url: string;
  /** Collapses older notifications with the same tag. */
  tag?: string;
};

export type PushSendResult =
  | { ok: true }
  /** 404/410: the device unsubscribed or the browser dropped it. Delete the row. */
  | { ok: false; gone: true; status: number }
  | { ok: false; gone: false; error: string; status?: number };

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function vapidPublicKey(): string | null {
  return readEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
}

export function isPushConfigured(): boolean {
  return Boolean(vapidPublicKey() && readEnv("VAPID_PRIVATE_KEY"));
}

function vapidSubject(): string {
  const explicit = readEnv("VAPID_SUBJECT");
  if (explicit) return explicit;
  // "Flya Space <noreply@flya.space>" → mailto:noreply@flya.space
  const from = readEnv("RESEND_FROM");
  const match = from?.match(/<([^>]+)>/) ?? (from && from.includes("@") ? [from, from] : null);
  if (match?.[1]) return `mailto:${match[1].trim()}`;
  return "https://flya.space";
}

export async function sendPush(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
  options: { ttlSeconds?: number } = {},
): Promise<PushSendResult> {
  const publicKey = vapidPublicKey();
  const privateKey = readEnv("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) {
    return { ok: false, gone: false, error: "push_not_configured" };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: vapidSubject(), publicKey, privateKey },
        // A reminder that could not be delivered within a day is stale anyway.
        TTL: options.ttlSeconds ?? 24 * 60 * 60,
        urgency: "normal",
        timeout: 10_000,
      },
    );
    return { ok: true };
  } catch (error) {
    const status =
      error && typeof error === "object" && typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : undefined;
    if (status === 404 || status === 410) return { ok: false, gone: true, status };
    const message = error instanceof Error ? error.message : String(error);
    // The push service's body can echo the endpoint; keep logs to the code.
    return { ok: false, gone: false, error: status ? `push service answered ${status}` : message, status };
  }
}
