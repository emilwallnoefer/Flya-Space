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
import type { SettingsAccess } from "../types";

type State = "checking" | "off" | "on" | "busy";

/**
 * Settings → Notifications. One switch: notifications on this device, or not.
 * A subscription belongs to a browser, so this is per device by nature; the
 * copy says so. What gets sent is listed underneath, so switching it on is an
 * informed choice rather than a blank cheque.
 */
export function NotificationsSection({ access }: { access: SettingsAccess }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  // Fleet notices: a per-PERSON preference (not per device), kept on the server.
  const [fleet, setFleet] = useState<boolean | null>(null);
  const [fleetBusy, setFleetBusy] = useState(false);

  useEffect(() => {
    // A role without Fleet has no Fleet notices (and the route refuses it).
    if (!access.fleet) return;
    let cancelled = false;
    void fetch("/api/settings/fleet-notices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { enabled?: boolean } | null) => {
        if (!cancelled) setFleet(data?.enabled !== false);
      })
      .catch(() => {
        if (!cancelled) setFleet(true);
      });
    return () => {
      cancelled = true;
    };
  }, [access.fleet]);

  async function toggleFleet() {
    if (fleet === null || fleetBusy) return;
    const next = !fleet;
    setFleetBusy(true);
    setFleet(next);
    try {
      const res = await fetch("/api/settings/fleet-notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) setFleet(!next);
    } catch {
      setFleet(!next);
    } finally {
      setFleetBusy(false);
    }
  }

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
            className={`ui-switch relative h-6 w-10 shrink-0 rounded-full border p-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/80 disabled:opacity-50 ${
              on ? "border-accent-deep/25 bg-accent-deep/40" : "border-glass/15 bg-glass/[0.08]"
            }`}
          >
            <span
              className={`block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                on ? "translate-x-4" : "translate-x-0"
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

      {access.fleet ? (
      <div className="rounded-xl border border-glass/15 bg-overlay/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">Fleet notices</p>
            <p className="mt-1.5 text-[15px] font-semibold leading-none text-ink">
              {fleet === null ? "Checking…" : fleet ? "On" : "Off"}
            </p>
            <p className="mt-2 text-[11px] leading-snug tracking-wide text-ink-4/90">
              About bookings that touch yours. Sent to your devices above, or by e-mail when none is switched on. This is one
              setting for you, on every device.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={fleet === true}
            aria-label={fleet ? "Turn Fleet notices off" : "Turn Fleet notices on"}
            aria-busy={fleetBusy}
            disabled={fleet === null || fleetBusy}
            onClick={() => void toggleFleet()}
            className={`ui-switch relative h-6 w-10 shrink-0 rounded-full border p-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/80 disabled:opacity-50 ${
              fleet ? "border-accent-deep/25 bg-accent-deep/40" : "border-glass/15 bg-glass/[0.08]"
            }`}
          >
            <span
              className={`block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                fleet ? "translate-x-4" : "translate-x-0"
              }`}
              aria-hidden
            />
          </button>
        </div>
      </div>
      ) : null}

      {access.time || access.fleet ? (
      <div className="rounded-xl border border-glass/15 bg-overlay/40 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">What you will receive</p>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-ink-2">
          {access.time ? (
          <li>
            <span className="font-medium text-ink">Friday, 19:00</span> — a reminder when none of this week&apos;s days has been logged
            in the Time Tracker yet.
          </li>
          ) : null}
          {access.fleet ? (
          <li>
            <span className="font-medium text-ink">Fleet</span> — when a unit you booked has not come back, when someone asks to keep a
            unit into your days or answers your request, when a waitlist spot becomes yours, and when a unit comes back early.
          </li>
          ) : null}
        </ul>
      </div>
      ) : null}
    </div>
  );
}
