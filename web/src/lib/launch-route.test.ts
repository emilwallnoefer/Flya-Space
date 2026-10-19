import { describe, expect, it } from "vitest";
import { parseRequestUrl, requestedDashboardModule, showsLaunchSplash } from "./launch-route";

describe("parseRequestUrl", () => {
  it("splits path and query as the proxy wrote them", () => {
    expect(parseRequestUrl("/dashboard")).toEqual({ pathname: "/dashboard", search: "" });
    expect(parseRequestUrl("/dashboard?module=time&section=x")).toEqual({
      pathname: "/dashboard",
      search: "?module=time&section=x",
    });
  });

  it("treats a missing or malformed header as absent", () => {
    expect(parseRequestUrl(null)).toBeNull();
    expect(parseRequestUrl(undefined)).toBeNull();
    expect(parseRequestUrl("")).toBeNull();
    expect(parseRequestUrl("https://evil.example/dashboard")).toBeNull();
  });
});

describe("requestedDashboardModule", () => {
  it("returns a known module", () => {
    expect(requestedDashboardModule("?module=time")).toBe("time");
    expect(requestedDashboardModule("?tour=phone&module=fleet")).toBe("fleet");
  });

  it("falls through to the home for anything else, like page.tsx", () => {
    expect(requestedDashboardModule("")).toBeNull();
    expect(requestedDashboardModule("?module=")).toBeNull();
    expect(requestedDashboardModule("?module=nope")).toBeNull();
    expect(requestedDashboardModule("?module=__proto__")).toBeNull();
  });
});

describe("showsLaunchSplash", () => {
  it("plays the opening on the workspace home and on login", () => {
    expect(showsLaunchSplash(parseRequestUrl("/dashboard"))).toBe(true);
    expect(showsLaunchSplash(parseRequestUrl("/dashboard?tour=phone"))).toBe(true);
    // An unknown module lands on the home, so the home's opening plays.
    expect(showsLaunchSplash(parseRequestUrl("/dashboard?module=bogus"))).toBe(true);
    expect(showsLaunchSplash(parseRequestUrl("/login"))).toBe(true);
    expect(showsLaunchSplash(parseRequestUrl("/login?next=%2Fdashboard"))).toBe(true);
  });

  it("skips it on a reload inside a module", () => {
    for (const m of ["mail", "time", "fleet", "planning", "fleetsheet", "roaddays", "settings", "admin"]) {
      expect(showsLaunchSplash(parseRequestUrl(`/dashboard?module=${m}`))).toBe(false);
    }
  });

  it("skips it on every other page", () => {
    expect(showsLaunchSplash(parseRequestUrl("/settings"))).toBe(false);
    expect(showsLaunchSplash(parseRequestUrl("/onboarding"))).toBe(false);
    expect(showsLaunchSplash(parseRequestUrl("/offline"))).toBe(false);
    expect(showsLaunchSplash(parseRequestUrl("/dashboard/anything"))).toBe(false);
  });

  it("keeps the old behaviour when the proxy did not run", () => {
    expect(showsLaunchSplash(null)).toBe(true);
  });
});
