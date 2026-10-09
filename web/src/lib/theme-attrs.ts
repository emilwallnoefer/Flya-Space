// The appearance catalogue, shared by the client store (lib/theme.ts), the SSR
// root layout and the appearance API route. No "use client" here on purpose:
// server code imports it too.
//
// Every appearance is rendered as a pair of attributes on <html>:
//   data-theme — the base skin whose tokens apply ("light", or absent for dark)
//   data-mode  — an optional variant layered on top of that base
// The CSS in app/tokens.css + app/decorations.css keys off exactly these two.
export const THEME_VALUES = ["dark", "light", "blue", "neu"] as const;
export type ThemeValue = (typeof THEME_VALUES)[number];

export function isThemeValue(v: unknown): v is ThemeValue {
  return typeof v === "string" && (THEME_VALUES as readonly string[]).includes(v);
}

export type ThemeAttributes = { theme?: "light"; mode?: "blue" | "neu" };

export function themeAttributes(theme: ThemeValue): ThemeAttributes {
  switch (theme) {
    case "light":
      return { theme: "light" };
    case "blue":
      return { theme: "light", mode: "blue" };
    case "neu":
      // Neumorphism is a light surface, so it rides on the light tokens.
      return { theme: "light", mode: "neu" };
    default:
      return {};
  }
}

/** <meta name="theme-color"> per appearance — the page background colour. */
export const THEME_COLORS: Record<ThemeValue, string> = {
  dark: "#020617",
  light: "#fcfaf5",
  blue: "#f7fafd",
  neu: "#ebecef",
};
