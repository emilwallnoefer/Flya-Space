"use client";

import { useSyncExternalStore } from "react";
import { getTheme, setTheme as persistTheme, THEMES } from "@/lib/theme";
import { getAccent, setAccent as persistAccent, ACCENTS } from "@/lib/accent";

// theme/accent live in an external store (persisted by lib/theme + lib/accent,
// which dispatch these window events on every change).
function subscribeTheme(onChange: () => void) {
  window.addEventListener("ma-theme-changed", onChange);
  return () => window.removeEventListener("ma-theme-changed", onChange);
}

function subscribeAccent(onChange: () => void) {
  window.addEventListener("ma-accent-changed", onChange);
  return () => window.removeEventListener("ma-accent-changed", onChange);
}

export function AppearanceSection() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "dark" as const);
  const accent = useSyncExternalStore(subscribeAccent, getAccent, () => "amber" as const);

  return (
    <div className="mt-5">
      <div className="rounded-xl border border-glass/15 bg-overlay/40 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">Appearance</p>
        <p className="mt-1.5 text-[15px] font-semibold leading-none text-ink">
          {THEMES.find((t) => t.value === theme)?.label ?? "Dark"}
        </p>
        <p className="mt-2 text-[11px] leading-snug tracking-wide text-ink-4/90">
          Choose the app look: the default dark theme, the softened Solarized Light skin, the pastel Glacier blue skin, or soft-extruded Neumorphism. Synced to your account, so it follows you across devices.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEMES.map((t) => {
            const selected = t.value === theme;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={selected}
                aria-label={t.label}
                onClick={() => persistTheme(t.value)}
                className={`flex flex-col items-center gap-2 rounded-lg border p-2.5 transition ${
                  selected
                    ? "border-accent/80 bg-accent/15"
                    : "border-glass/10 bg-glass/[0.03] hover:bg-glass/[0.06]"
                }`}
              >
                <span
                  className="h-7 w-7 rounded-full shadow-sm ring-1 ring-inset ring-black/10"
                  style={{ background: t.swatch }}
                  aria-hidden
                />
                <span className="text-center text-[11px] font-medium leading-tight tracking-wide text-ink-2/85">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {theme === "light" ? (
        <div className="mt-3 rounded-xl border border-glass/15 bg-overlay/40 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">Accent</p>
          <p className="mt-1.5 text-[15px] font-semibold leading-none text-ink">
            {ACCENTS.find((a) => a.value === accent)?.label ?? "Warm amber"}
          </p>
          <p className="mt-2 text-[11px] leading-snug tracking-wide text-ink-4/90">
            Accent color for the Solarized Light skin: buttons, links, avatars and highlights. Synced to your account.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {ACCENTS.map((a) => {
              const selected = a.value === accent;
              return (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={a.label}
                  onClick={() => persistAccent(a.value)}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-2.5 transition ${
                    selected
                      ? "border-accent/80 bg-accent/15"
                      : "border-glass/10 bg-glass/[0.03] hover:bg-glass/[0.06]"
                  }`}
                >
                  <span
                    className="h-7 w-7 rounded-full shadow-sm ring-1 ring-inset ring-black/10"
                    style={{ background: a.swatch }}
                    aria-hidden
                  />
                  <span className="text-center text-[11px] font-medium leading-tight tracking-wide text-ink-2/85">
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
