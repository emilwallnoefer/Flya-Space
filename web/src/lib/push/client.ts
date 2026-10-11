"use client";

/**
 * Browser side of phone notifications: what this device can do, and
 * switching the subscription on or off. Used by the Settings → Notifications
 * section; the server half is `app/api/push/subscription`.
 *
 * iOS is the special case. Safari delivers Web Push only to a site that was
 * added to the Home Screen and opened from there — a tab never qualifies — and
 * the permission prompt must come from a tap. `support()` tells the UI which of
 * those is missing so it can say so instead of failing quietly.
 */

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "no_service_worker" | "no_push" | "ios_not_installed" | "denied" | "insecure" };

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { ok: false, reason: "no_push" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (!("serviceWorker" in navigator)) return { ok: false, reason: "no_service_worker" };
  if (!("PushManager" in window) || !("Notification" in window)) {
    // iOS Safari in a tab has neither; installed, it has both.
    if (isIos() && !isStandalone()) return { ok: false, reason: "ios_not_installed" };
    return { ok: false, reason: "no_push" };
  }
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  return { ok: true };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The worker `components/service-worker-registrar.tsx` registers in
 * production. In development nothing registers it, so the toggle registers it
 * here; the offline cache it builds is harmless there.
 */
async function readyWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  const build = encodeURIComponent(process.env.NEXT_PUBLIC_APP_BUILD ?? "0");
  await navigator.serviceWorker.register(`/sw.js?v=${build}`, { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport().ok === false) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Does the server know this device? False when there is no subscription at all. */
export async function isSubscribedHere(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  const res = await fetch(`/api/push/subscription?endpoint=${encodeURIComponent(sub.endpoint)}`);
  if (!res.ok) return false;
  const data = (await res.json()) as { registered?: boolean };
  return data.registered === true;
}

export type SubscribeResult = { ok: true } | { ok: false; error: string };

async function postSubscription(sub: PushSubscription): Promise<Response> {
  return fetch("/api/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

export async function subscribeThisDevice(): Promise<SubscribeResult> {
  const support = pushSupport();
  if (!support.ok) return { ok: false, error: supportMessage(support.reason) };
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) return { ok: false, error: "Notifications are not set up on this server." };

  // Must run inside the user's tap on iOS; nothing async before it.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: supportMessage("denied") };

  try {
    const reg = await readyWorker();
    const options: PushSubscriptionOptionsInit = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    };
    let sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe(options));
    let res = await postSubscription(sub);
    if (res.status === 409) {
      // Registered to another account on this browser: start a fresh endpoint.
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe(options);
      res = await postSubscription(sub);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: data?.error ?? "Could not save this device." };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not subscribe.";
    // A key change on the server makes subscribe() throw on a device that
    // still holds the old subscription — drop it so the next try is clean.
    if (/applicationServerKey|different/i.test(message)) {
      const stale = await currentSubscription();
      await stale?.unsubscribe().catch(() => {});
    }
    return { ok: false, error: message };
  }
}

export async function unsubscribeThisDevice(): Promise<SubscribeResult> {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  const res = await fetch("/api/push/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) return { ok: false, error: "Turned off on this device, but the server did not confirm." };
  return { ok: true };
}

export function supportMessage(reason: Exclude<PushSupport, { ok: true }>["reason"]): string {
  switch (reason) {
    case "ios_not_installed":
      return "On iPhone, add Flya Space to your Home Screen first (Share → Add to Home Screen) and open it from there.";
    case "denied":
      return "Notifications are blocked for Flya Space in your browser or phone settings. Allow them there, then try again.";
    case "insecure":
      return "Notifications need a secure (https) connection.";
    case "no_service_worker":
    case "no_push":
      return "This browser does not support notifications.";
  }
}
