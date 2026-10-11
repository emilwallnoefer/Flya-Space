"use client";

import { useEffect, useState } from "react";
import {
  isSubscribedHere,
  pushSupport,
  subscribeThisDevice,
  supportMessage,
  unsubscribeThisDevice,
  type PushSupport,
} from "@/lib/push/client";

type State = "checking" | "off" | "on" | "busy";

/**
 * Settings → Notifications. One switch: notifications on this device, or not.
 * A subscription belongs to a browser, so this is per device by nature; the
 * copy says so. What gets sent is listed underneath, so switching it on is an
 * informed choice rather than a blank cheque.
 */
export function NotificationsSection() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  // Both answers come from the browser (and, for "on", from the server), so
  // they are read after mount and applied together once known.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = pushSupport();
      const on = await (s.ok ? isSubscribedHere().catch(() => false) : Promise.resolve(false));
      if (cancelled) return;
      setSupport(s);
      setState(on ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const on = state === "on";
  const disabled = state === "checking" || state === "busy" || (support !== null && !support.ok);

  async function toggle() {
    if (disabled) return;
    setError(null);
    const was = state;
    setState("busy");
    const result = was === "on" ? await unsubscribeThisDevice() : await subscribeThisDevice();
    if (result.ok) {
      setState(was === "on" ? "off" : "on");
    } else {
      setState(was === "on" ? "on" : "off");
      setError(result.error);
      // A refusal can change what we can offer (e.g. the user tapped "Don't allow").
      setSupport(pushSupport());
    }
  }

  const statusLabel = state === "checking" ? "Checking…" : state === "busy" ? "One moment…" : on ? "On" : "Off";

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-glass/15 bg-overlay/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">Notifications on this device</p>
            <p className="mt-1.5 text-[15px] font-semibold leading-none text-ink">{statusLabel}</p>
            <p className="mt-2 text-[11px] leading-snug tracking-wide text-ink-4/90">
              Delivered like any app notification, also when Flya Space is closed. Each phone or computer is switched on separately.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={on ? "Turn notifications off on this device" : "Turn notifications on on this device"}
            aria-busy={state === "busy"}
            disabled={disabled}
            onClick={() => void toggle()}
            className={`relative h-7 w-[46px] shrink-0 rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/80 disabled:opacity-50 ${
              on
                ? "border-accent-deep/25 bg-accent-deep/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "border-glass/15 bg-glass/[0.07]"
            }`}
          >
            <span
              className={`absolute top-1 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                on ? "translate-x-[22px]" : "translate-x-0"
              }`}
              aria-hidden
            />
          </button>
        </div>
        {support && !support.ok ? (
          <p className="mt-3 text-[12px] leading-snug text-warn">{supportMessage(support.reason)}</p>
        ) : null}
        {error ? <p className="mt-3 text-[12px] leading-snug text-danger">{error}</p> : null}
      </div>

      <div className="rounded-xl border border-glass/15 bg-overlay/40 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">What you will receive</p>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-ink-2">
          <li>
            <span className="font-medium text-ink">Friday, 19:00</span> — a reminder when none of this week&apos;s days has been logged
            in the Time Tracker yet.
          </li>
        </ul>
      </div>
    </div>
  );
}
