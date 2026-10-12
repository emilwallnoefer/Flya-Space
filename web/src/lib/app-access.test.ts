import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessTokenIsStale, forbidHeldAccount, hasAppAccess, roleInAccessToken } from "./app-access";

/**
 * hasAppAccess is the line between a held account and a working one, on every
 * non-admin route (security audit run-4 F3). These pin the inputs that must NOT
 * open the door as firmly as the ones that must.
 */
const original = process.env.ADMIN_EMAILS;
beforeEach(() => {
  process.env.ADMIN_EMAILS = "boss@flyability.com";
});
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = original;
});

describe("hasAppAccess", () => {
  it("lets in any known role from app_metadata", () => {
    for (const role of ["sales", "eu_pilot", "us_pilot", "hr", "pilot"]) {
      expect(hasAppAccess({ email: "a@flyability.com", app_metadata: { role } })).toBe(true);
    }
  });

  it("lets in an admin with no role", () => {
    expect(hasAppAccess({ email: "Boss@Flyability.com", app_metadata: {} })).toBe(true);
  });

  it("holds an account with no role", () => {
    expect(hasAppAccess({ email: "new@flyability.com", app_metadata: {} })).toBe(false);
    expect(hasAppAccess({ email: "new@flyability.com" })).toBe(false);
    expect(hasAppAccess({ email: "new@flyability.com", app_metadata: { role: null } })).toBe(false);
  });

  it("holds an unknown or malformed role", () => {
    expect(hasAppAccess({ email: "x@flyability.com", app_metadata: { role: "admin" } })).toBe(false);
    expect(hasAppAccess({ email: "x@flyability.com", app_metadata: { role: "" } })).toBe(false);
    expect(hasAppAccess({ email: "x@flyability.com", app_metadata: ["sales"] })).toBe(false);
  });

  it("ignores a self-assigned role in user_metadata", () => {
    const user = { email: "x@flyability.com", app_metadata: {}, user_metadata: { role: "sales" } };
    expect(hasAppAccess(user)).toBe(false);
  });

  it("holds a missing user", () => {
    expect(hasAppAccess(null)).toBe(false);
    expect(hasAppAccess(undefined)).toBe(false);
  });
});

describe("forbidHeldAccount", () => {
  it("returns null for an account with access", () => {
    expect(forbidHeldAccount({ email: "a@flyability.com", app_metadata: { role: "sales" } })).toBeNull();
  });

  it("returns a 403 for a held account", () => {
    const res = forbidHeldAccount({ email: "new@flyability.com", app_metadata: {} });
    expect(res?.status).toBe(403);
  });
});

describe("roleInAccessToken", () => {
  const token = (claims: unknown) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("reads app_metadata.role", () => {
    expect(roleInAccessToken(token({ app_metadata: { role: "sales" } }))).toBe("sales");
  });

  it("returns null when there is no role or no token", () => {
    expect(roleInAccessToken(token({ app_metadata: {} }))).toBeNull();
    expect(roleInAccessToken(null)).toBeNull();
    expect(roleInAccessToken("not-a-jwt")).toBeNull();
    expect(roleInAccessToken("a.!!!.b")).toBeNull();
  });
});

describe("accessTokenIsStale", () => {
  const token = (claims: unknown) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const current = token({
    app_metadata: { role: "sales" },
    user_metadata: { appearance_theme: "dark", appearance_accent: "amber" },
  });
  const fresh = {
    app_metadata: { role: "sales" },
    user_metadata: { appearance_theme: "dark", appearance_accent: "amber" },
  };

  it("is fresh when the token matches the account", () => {
    expect(accessTokenIsStale(current, fresh)).toBe(false);
  });

  it("is stale once the skin was changed elsewhere", () => {
    // The phone saved neu; the laptop's token still says dark.
    expect(
      accessTokenIsStale(current, { ...fresh, user_metadata: { ...fresh.user_metadata, appearance_theme: "neu" } }),
    ).toBe(true);
    expect(
      accessTokenIsStale(current, { ...fresh, user_metadata: { ...fresh.user_metadata, appearance_accent: "blue" } }),
    ).toBe(true);
  });

  it("is stale once an admin changed the role", () => {
    expect(accessTokenIsStale(current, { ...fresh, app_metadata: { role: "hr" } })).toBe(true);
    expect(accessTokenIsStale(current, { ...fresh, app_metadata: {} })).toBe(true);
  });

  it("treats a missing claim and a missing field as the same thing", () => {
    const bare = token({ app_metadata: {}, user_metadata: {} });
    expect(accessTokenIsStale(bare, { app_metadata: {}, user_metadata: {} })).toBe(false);
    expect(accessTokenIsStale(bare, {})).toBe(false);
  });

  it("never refreshes on a token it cannot read", () => {
    expect(accessTokenIsStale(null, fresh)).toBe(false);
    expect(accessTokenIsStale("not-a-jwt", fresh)).toBe(false);
  });
});
