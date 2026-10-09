import { describe, expect, it } from "vitest";
import { isThemeValue, THEME_COLORS, THEME_VALUES, themeAttributes } from "./theme-attrs";

describe("themeAttributes", () => {
  it("maps every appearance to the attribute pair the CSS keys off", () => {
    expect(themeAttributes("dark")).toEqual({});
    expect(themeAttributes("light")).toEqual({ theme: "light" });
    expect(themeAttributes("blue")).toEqual({ theme: "light", mode: "blue" });
    expect(themeAttributes("neu")).toEqual({ theme: "light", mode: "neu" });
  });

  it("gives each appearance a distinct attribute pair", () => {
    const seen = new Set(THEME_VALUES.map((t) => JSON.stringify(themeAttributes(t))));
    expect(seen.size).toBe(THEME_VALUES.length);
  });

  it("has a browser-chrome colour for every appearance", () => {
    for (const t of THEME_VALUES) expect(THEME_COLORS[t]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("isThemeValue", () => {
  it("accepts the catalogue and nothing else", () => {
    for (const t of THEME_VALUES) expect(isThemeValue(t)).toBe(true);
    for (const junk of ["glacier", "sky", "glass", "NEU", "", null, undefined, 1]) {
      expect(isThemeValue(junk), String(junk)).toBe(false);
    }
  });
});
