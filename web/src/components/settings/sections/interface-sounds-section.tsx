"use client";

import { useSyncExternalStore } from "react";
import { getUiSoundsEnabled, setUiSoundsEnabled as persistUiSoundsEnabled } from "@/lib/ui-sounds";

// The enabled flag lives in an external store (persisted by lib/ui-sounds,
// which dispatches this window event on every change).
function subscribeUiSounds(onChange: () => void) {
  window.addEventListener("ma-ui-sounds-changed", onChange);
  return () => window.removeEventListener("ma-ui-sounds-changed", onChange);
}

export function InterfaceSoundsSection() {
  const uiSoundsOn = useSyncExternalStore(subscribeUiSounds, getUiSoundsEnabled, () => false);

  return (
    <div className="mt-5">
      <div className="rounded-xl border border-glass/15 bg-overlay/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">Interface sounds</p>
            <p className="mt-1.5 text-[15px] font-semibold leading-none text-ink">{uiSoundsOn ? "On" : "Off"}</p>
            <p className="mt-2 text-[11px] leading-snug tracking-wide text-ink-4/90">
              Module switches, mail actions, live preview typing, and time tracker feedback. Stored on this device.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={uiSoundsOn}
            aria-label={uiSoundsOn ? "Turn interface sounds off" : "Turn interface sounds on"}
            onClick={() => persistUiSoundsEnabled(!uiSoundsOn)}
            className={`relative h-7 w-[46px] shrink-0 rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/80 ${
              uiSoundsOn
                ? "border-accent-deep/25 bg-accent-deep/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "border-glass/15 bg-glass/[0.07]"
            }`}
          >
            <span
              className={`absolute top-1 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                uiSoundsOn ? "translate-x-[22px]" : "translate-x-0"
              }`}
              aria-hidden
            />
          </button>
        </div>
      </div>
    </div>
  );
}
