import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, generateCspNonce } from "./csp";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  delete process.env.CSP_ENFORCE;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function directive(csp: string, name: string): string {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name)!;
}

describe("generateCspNonce", () => {
  it("is unique per call and long enough to be unguessable", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => generateCspNonce()));
    expect(nonces.size).toBe(200);
    // 16 random bytes -> 24 base64 chars.
    expect([...nonces][0]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("buildCsp", () => {
  it("carries the nonce and does NOT allow arbitrary inline script", () => {
    const csp = buildCsp("TESTNONCE");
    const scriptSrc = directive(csp, "script-src");
    expect(scriptSrc).toContain("'nonce-TESTNONCE'");
    // The whole point of the nonce: this must never come back.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("keeps the framing and injection guards", () => {
    const csp = buildCsp("n");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("pins connect-src to self plus the Supabase project only", () => {
    const connect = directive(buildCsp("n"), "connect-src");
    expect(connect).toBe("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
  });

  it("falls back to self when the Supabase URL is missing or malformed", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    expect(directive(buildCsp("n"), "connect-src")).toBe("connect-src 'self'");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url";
    expect(directive(buildCsp("n"), "connect-src")).toBe("connect-src 'self'");
  });

  it("frames only ourselves and Google's sheet editor — not Google sign-in", () => {
    expect(directive(buildCsp("n"), "frame-src")).toBe("frame-src 'self' https://docs.google.com");
  });

  it("keeps style-src 'unsafe-inline' — Tailwind and framer-motion need it", () => {
    expect(directive(buildCsp("n"), "style-src")).toContain("'unsafe-inline'");
  });

  it("widens for the Vercel Live toolbar on preview only, never in production", () => {
    process.env.VERCEL_ENV = "preview";
    const preview = buildCsp("n");
    expect(directive(preview, "script-src")).toContain("https://vercel.live");
    expect(directive(preview, "script-src")).toContain("'unsafe-eval'");

    process.env.VERCEL_ENV = "production";
    const prod = buildCsp("n");
    expect(prod).not.toContain("vercel.live");
    expect(prod).not.toContain("'unsafe-eval'");
  });
});

describe("cspHeaderName", () => {
  it("enforces only when CSP_ENFORCE=1", () => {
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
    process.env.CSP_ENFORCE = "1";
    expect(cspHeaderName()).toBe("Content-Security-Policy");
    process.env.CSP_ENFORCE = "true";
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });
});
