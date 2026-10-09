// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `theme.ts` caches the chosen theme in a module-level variable and registers a
 * `storage` listener at import time, so every test re-imports it fresh via
 * `load()` to get a clean cache and a clean listener.
 */

const syncAppearanceToServer = vi.fn();
vi.mock("@/lib/appearance-sync", () => ({
  syncAppearanceToServer: (...args: unknown[]) => syncAppearanceToServer(...args),
}));

const STORAGE_KEY = "ma_theme";

async function load() {
  vi.resetModules();
  return import("./theme");
}

function changes(): string[] {
  return seen;
}

let seen: string[] = [];
const onChange = (event: Event) => {
  seen.push((event as CustomEvent<{ theme: string }>).detail.theme);
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  seen = [];
  syncAppearanceToServer.mockClear();
  window.addEventListener("ma-theme-changed", onChange);
});

afterEach(() => {
  window.removeEventListener("ma-theme-changed", onChange);
  vi.restoreAllMocks();
});

describe("reading the stored theme", () => {
  it("defaults to dark when nothing is stored", async () => {
    const { getTheme } = await load();
    expect(getTheme()).toBe("dark");
  });

  it("returns a stored theme", async () => {
    for (const stored of ["blue", "neu"]) {
      window.localStorage.setItem(STORAGE_KEY, stored);
      const { getTheme } = await load();
      expect(getTheme(), stored).toBe(stored);
    }
  });

  it("collapses the retired glacier and sky skins into blue", async () => {
    for (const legacy of ["glacier", "sky"]) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      const { getTheme } = await load();
      expect(getTheme(), legacy).toBe("blue");
    }
  });

  it("falls back to dark for a value it does not recognise", async () => {
    for (const junk of ["", "solarized", "glass", "BLUE", "null"]) {
      window.localStorage.setItem(STORAGE_KEY, junk);
      const { getTheme } = await load();
      expect(getTheme(), junk).toBe("dark");
    }
  });

  it("falls back to dark when localStorage is unavailable (private mode)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { getTheme } = await load();
    expect(getTheme()).toBe("dark");
  });

  it("caches the first read, so a later external write does not leak in", async () => {
    const { getTheme } = await load();
    expect(getTheme()).toBe("dark");
    window.localStorage.setItem(STORAGE_KEY, "light");
    expect(getTheme()).toBe("dark");
  });
});

describe("setTheme", () => {
  it("persists, caches, syncs and announces the change", async () => {
    const { setTheme, getTheme } = await load();
    setTheme("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(getTheme()).toBe("light");
    expect(syncAppearanceToServer).toHaveBeenCalledWith({ theme: "light" });
    expect(changes()).toEqual(["light"]);
  });

  it("renders blue as the light skin plus the blue tint", async () => {
    const { setTheme } = await load();
    setTheme("blue");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.mode).toBe("blue");
  });

  it("clears the tint when moving from blue to light", async () => {
    const { setTheme } = await load();
    setTheme("blue");
    setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.mode).toBeUndefined();
  });

  it("renders neumorphism as the light skin plus the neu mode", async () => {
    const { setTheme } = await load();
    setTheme("neu");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.mode).toBe("neu");
  });

  it("clears both attributes for dark, the attribute-free default", async () => {
    const { setTheme } = await load();
    setTheme("blue");
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.mode).toBeUndefined();
  });

  it("still applies the theme when the write is rejected", async () => {
    const { setTheme, getTheme } = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(changes()).toEqual(["light"]);
  });
});

describe("another tab changing the theme", () => {
  // Earlier `load()` calls leave their own storage listeners on this window, so
  // the announced values are compared as a set rather than by count.
  it("adopts the new value and announces it", async () => {
    const { getTheme } = await load();
    expect(getTheme()).toBe("dark"); // prime the cache before the other tab writes
    window.localStorage.setItem(STORAGE_KEY, "blue");
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "blue" }));
    expect(getTheme()).toBe("blue");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.mode).toBe("blue");
    expect([...new Set(changes())]).toEqual(["blue"]);
  });

  it("ignores a write to any other key", async () => {
    const { getTheme } = await load();
    expect(getTheme()).toBe("dark");
    window.localStorage.setItem(STORAGE_KEY, "blue");
    window.dispatchEvent(new StorageEvent("storage", { key: "something_else", newValue: "blue" }));
    expect(getTheme()).toBe("dark");
    expect(changes()).toEqual([]);
  });
});
