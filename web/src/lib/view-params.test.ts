import { afterEach, describe, expect, it } from "vitest";
import { pushViewParams, readViewParam, wasPushedByUs, writeViewParams } from "./view-params";

const MODULES = ["mail", "time", "fleet", "settings", "admin"] as const;

/** Minimal stand-in for the two browser APIs the helpers touch. */
function stubWindow(href: string) {
  const calls: string[] = [];
  const pushed: unknown[] = [];
  const state = { tree: "next-router-state" };
  const history = {
    state: state as unknown,
    replaceState(nextState: unknown, _title: string, nextHref: string) {
      expect(nextState).toBe(state);
      href = nextHref;
      calls.push(nextHref);
    },
    pushState(nextState: unknown, _title: string, nextHref: string) {
      history.state = nextState;
      href = nextHref;
      pushed.push(nextState);
      calls.push(nextHref);
    },
  };
  (globalThis as unknown as { window: unknown }).window = {
    location: { get href() { return href; }, get search() { return new URL(href).search; } },
    history,
  };
  return { calls, pushed, current: () => href };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("readViewParam", () => {
  it("returns a value listed as valid", () => {
    stubWindow("https://app.test/dashboard?module=fleet");
    expect(readViewParam("module", MODULES)).toBe("fleet");
  });

  it("ignores a value outside the allowed list", () => {
    stubWindow("https://app.test/dashboard?module=payroll");
    expect(readViewParam("module", MODULES)).toBeNull();
  });

  it("returns null when the param is absent", () => {
    stubWindow("https://app.test/dashboard");
    expect(readViewParam("module", MODULES)).toBeNull();
  });

  it("returns null on the server, where there is no URL to read", () => {
    expect(readViewParam("module", MODULES)).toBeNull();
  });
});

describe("writeViewParams", () => {
  it("sets a param and keeps the rest of the URL", () => {
    const win = stubWindow("https://app.test/dashboard?ref=mail");
    writeViewParams({ module: "admin" });
    expect(win.current()).toBe("https://app.test/dashboard?ref=mail&module=admin");
  });

  it("removes a param when the value is null", () => {
    const win = stubWindow("https://app.test/dashboard?module=admin&section=audit");
    writeViewParams({ module: null, section: null });
    expect(win.current()).toBe("https://app.test/dashboard");
  });

  it("does not touch history when nothing would change", () => {
    const win = stubWindow("https://app.test/dashboard?module=admin");
    writeViewParams({ module: "admin", section: null });
    expect(win.calls).toEqual([]);
  });

  it("is a no-op on the server", () => {
    expect(() => writeViewParams({ module: "admin" })).not.toThrow();
  });
});

describe("pushViewParams", () => {
  it("adds a history entry that carries the router state and our marker", () => {
    const win = stubWindow("https://app.test/dashboard");
    expect(wasPushedByUs()).toBe(false);
    pushViewParams({ module: "time" });
    expect(win.current()).toBe("https://app.test/dashboard?module=time");
    expect(win.pushed).toHaveLength(1);
    // Next's own routing data must survive the push, with our tag beside it.
    expect(win.pushed[0]).toMatchObject({ tree: "next-router-state" });
    expect(wasPushedByUs()).toBe(true);
  });

  it("does not push when nothing would change", () => {
    const win = stubWindow("https://app.test/dashboard?module=time");
    pushViewParams({ module: "time" });
    expect(win.calls).toEqual([]);
    expect(wasPushedByUs()).toBe(false);
  });

  it("is a no-op on the server", () => {
    expect(() => pushViewParams({ module: "time" })).not.toThrow();
    expect(wasPushedByUs()).toBe(false);
  });
});
