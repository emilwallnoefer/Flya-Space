"use client";

import { useEffect, useState } from "react";
import { isSubscribedHere, pushSupport, subscribeThisDevice } from "@/lib/push/client";
import {
  NOTIFICATIONS_PROMPT_DISMISSED_KEY,
  readDismissedAt,
  shouldOfferNotifications,
  shouldResubscribeQuietly,
} from "@/lib/push/first-launch";
import { MobileButton, MobileSheet } from "./primitives";

/**
 * The phone's first-launch offer: one sheet, one "Turn on" button. The tap is
 * what the browser needs to show its permission prompt, so this is as close to
 * "on by default" as a web app gets.
 *
 * Also the quiet repair: a device that already granted permission but is no
 * longer registered (storage cleared, reinstall, key rotation) is re-subscribed
 * here without any UI.
 *
 * `held` keeps it closed while another sheet (What's new) is up; it opens as
 * soon as that one goes away.
 */
export function NotificationsPrompt({ held }: { held: boolean }) {
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const support = pushSupport();
      if (!support.ok) return;
      const permission = Notification.permission;
      const registered = await isSubscribedHere().catch(() => false);
      if (cancelled) return;
      const facts = { supported: true, permission, registered };
      if (shouldResubscribeQuietly(facts)) {
        void subscribeThisDevice();
        return;
      }
      if (shouldOfferNotifications({ ...facts, dismissedAt: readDismissedAt(window.localStorage), now: Date.now() })) {
        setOffer(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    setOffer(false);
    try {
      window.localStorage.setItem(NOTIFICATIONS_PROMPT_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage blocked: we will simply ask again next launch.
    }
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    const result = await subscribeThisDevice();
    setBusy(false);
    if (result.ok) {
      setOffer(false);
      return;
    }
    // A refusal in the browser's own prompt ends the matter: permission is now
    // "denied" and the sheet has nothing more to offer.
    if (Notification.permission === "denied") {
      setOffer(false);
      return;
    }
    setError(result.error);
  }

  return (
    <MobileSheet
      open={offer && !held}
      onClose={dismiss}
      title="Notifications"
      footer={
        <div className="space-y-2">
          <MobileButton onClick={() => void turnOn()} disabled={busy}>
            {busy ? "One moment…" : "Turn on notifications"}
          </MobileButton>
          <MobileButton variant="ghost" onClick={dismiss} disabled={busy}>
            Not now
          </MobileButton>
        </div>
      }
    >
      <p className="text-sm text-ink-3">Flya Space would like to send you notifications. You can change this any time in Settings.</p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </MobileSheet>
  );
}
