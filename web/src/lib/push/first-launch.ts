/**
 * When the phone app offers notifications on its own, and when it quietly
 * keeps them working. Pure rules; the shell supplies the facts.
 *
 * Browsers only grant notifications from a tap, so "on by default" is not
 * available to a web app. The closest thing is to ask once, early, with one
 * button — the same first-launch prompt a native app shows.
 */

export const NOTIFICATIONS_PROMPT_DISMISSED_KEY = "fs-notifications-prompt-dismissed-at";
/** After "Not now", stay quiet this long before offering again. */
export const PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export type PromptFacts = {
  /** `pushSupport().ok` — the browser can do push here at all. */
  supported: boolean;
  /** `Notification.permission` */
  permission: "default" | "granted" | "denied";
  /** The server knows this device's subscription. */
  registered: boolean;
  /** ms epoch of the last "Not now", or null. */
  dismissedAt: number | null;
  now: number;
};

/** Show the one-tap offer? Only while nothing has been decided yet. */
export function shouldOfferNotifications(facts: PromptFacts): boolean {
  if (!facts.supported) return false;
  if (facts.permission !== "default") return false;
  if (facts.registered) return false;
  if (facts.dismissedAt !== null && facts.now - facts.dismissedAt < PROMPT_SNOOZE_MS) return false;
  return true;
}

/**
 * Permission was granted earlier but the server has no live subscription for
 * this device (browser dropped it, reinstall, key rotation): re-subscribe
 * without asking — `subscribe()` needs no gesture once permission is granted.
 */
export function shouldResubscribeQuietly(facts: Pick<PromptFacts, "supported" | "permission" | "registered">): boolean {
  return facts.supported && facts.permission === "granted" && !facts.registered;
}

export function readDismissedAt(storage: Pick<Storage, "getItem">): number | null {
  try {
    const raw = storage.getItem(NOTIFICATIONS_PROMPT_DISMISSED_KEY);
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
