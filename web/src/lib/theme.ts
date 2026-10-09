"use client";

import { syncAppearanceToServer } from "@/lib/appearance-sync";
import { isThemeValue, themeAttributes, type ThemeValue } from "@/lib/theme-attrs";

// Appearance mode. `dark` and `light` (softened Solarized) are the base skins;
// the rest are variants layered on one of them via data-mode (see
// lib/theme-attrs.ts for the mapping): `blue` is a pastel cool-blue light skin,
// `neu` the neumorphic soft-extruded light skin, `glass` frosted glass over a
// vivid dark mesh.
export type Theme = ThemeValue;

export const THEMES: { value: Theme; label: string; swatch: string }[] = [
  { value: "dark", label: "Dark", swatch: "#0f172a" },
  { value: "light", label: "Solarized light", swatch: "#fcfaf5" },
  { value: "blue", label: "Glacier blue", swatch: "#a9cdf0" },
  {
    value: "neu",
    label: "Neumorphism",
    swatch: "radial-gradient(circle at 35% 30%, #f4f7fb, #e3e8ef 55%, #c3cbd6)",
  },
  {
    value: "glass",
    label: "Glassmorphism",
    swatch: "linear-gradient(135deg, #7c3aed, #db2777 50%, #0ea5e9)",
  },
];

const THEME_STORAGE_KEY = "ma_theme";
const DEFAULT_THEME: Theme = "dark";

// Map any stored value to a current theme. Legacy "glacier"/"sky" (the old split
// cool-blue skins) now collapse into the single "blue" mode.
function normalizeStoredTheme(v: unknown): Theme {
  if (v === "glacier" || v === "sky") return "blue";
  return isThemeValue(v) ? v : DEFAULT_THEME;
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return normalizeStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

let themeCache: Theme | null = null;

function applyThemeAttribute(theme: Theme): void {
  if (typeof document === "undefined") return;
  // Mirrors the pre-hydration bootstrap script in app/layout.tsx.
  const root = document.documentElement;
  const attrs = themeAttributes(theme);
  if (attrs.theme) root.dataset.theme = attrs.theme;
  else delete root.dataset.theme;
  if (attrs.mode) root.dataset.mode = attrs.mode;
  else delete root.dataset.mode;
}

export function getTheme(): Theme {
  if (themeCache === null && typeof window !== "undefined") {
    themeCache = readStoredTheme();
  }
  return themeCache ?? DEFAULT_THEME;
}

export function setTheme(theme: Theme): void {
  themeCache = theme;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Ignore quota / private mode.
  }
  applyThemeAttribute(theme);
  syncAppearanceToServer({ theme });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ma-theme-changed", { detail: { theme } }));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    themeCache = readStoredTheme();
    applyThemeAttribute(themeCache);
    window.dispatchEvent(
      new CustomEvent("ma-theme-changed", { detail: { theme: themeCache } }),
    );
  });
}
