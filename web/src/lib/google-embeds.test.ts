import { describe, expect, it } from "vitest";
import { canSeeGoogleEmbeds, formEmbed, sheetEmbed, withRange } from "./google-embeds";

// Made up: the real ids live in env, and this repo is public.
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const FORM_ID = "1FAIpQLSfakeFakeFakeFakeFakeFakeFakeFakeFakeFake";

describe("canSeeGoogleEmbeds", () => {
  it("shows the embeds to pilots and admins only", () => {
    expect(canSeeGoogleEmbeds("eu_pilot", false)).toBe(true);
    expect(canSeeGoogleEmbeds("us_pilot", false)).toBe(true);
    expect(canSeeGoogleEmbeds("sales", false)).toBe(false);
    expect(canSeeGoogleEmbeds("hr", false)).toBe(false);
    expect(canSeeGoogleEmbeds(null, false)).toBe(false);
  });

  it("shows them to admins whatever role they hold", () => {
    expect(canSeeGoogleEmbeds("sales", true)).toBe(true);
    expect(canSeeGoogleEmbeds("hr", true)).toBe(true);
    expect(canSeeGoogleEmbeds(null, true)).toBe(true);
  });
});

describe("sheetEmbed", () => {
  it("embeds the editor with menus, on the configured tab", () => {
    const urls = sheetEmbed(ID, "365898566")!;
    expect(urls.kind).toBe("sheet");
    expect(urls.embed).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit?rm=embedded#gid=365898566`);
    expect(urls.open).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=365898566`);
  });

  it("signs in on Google and returns to the sheet", () => {
    const { signIn, open } = sheetEmbed(ID, "365898566")!;
    const url = new URL(signIn);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("continue")).toBe(open);
  });

  it("falls back to the first tab when the gid is missing or not a number", () => {
    expect(sheetEmbed(ID, undefined)!.embed).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit?rm=embedded`);
    expect(sheetEmbed(ID, "abc")!.embed).not.toContain("gid");
  });

  it("returns null for a missing or malformed id, so the card stays hidden", () => {
    expect(sheetEmbed(undefined, "1")).toBeNull();
    expect(sheetEmbed("  ", "1")).toBeNull();
    expect(sheetEmbed("../evil?x=", "1")).toBeNull();
  });
});

describe("formEmbed", () => {
  it("embeds the published form and opens it in full", () => {
    const urls = formEmbed(` ${FORM_ID} `)!;
    expect(urls.kind).toBe("form");
    expect(urls.embed).toBe(`https://docs.google.com/forms/d/e/${FORM_ID}/viewform?embedded=true`);
    expect(urls.open).toBe(`https://docs.google.com/forms/d/e/${FORM_ID}/viewform`);
    expect(new URL(urls.signIn).searchParams.get("continue")).toBe(urls.open);
  });

  it("returns null for a missing id or a pasted URL", () => {
    expect(formEmbed(undefined)).toBeNull();
    expect(formEmbed(`https://docs.google.com/forms/d/e/${FORM_ID}/viewform`)).toBeNull();
  });
});

describe("withRange", () => {
  const base = `https://docs.google.com/spreadsheets/d/${ID}/edit`;

  it("adds the cell to an existing hash, or starts one", () => {
    expect(withRange(`${base}?rm=embedded#gid=42`, "A3204")).toBe(`${base}?rm=embedded#gid=42&range=A3204`);
    expect(withRange(`${base}?rm=embedded`, "KQ2")).toBe(`${base}?rm=embedded#range=KQ2`);
  });

  it("leaves the URL alone without a valid cell", () => {
    expect(withRange(base, null)).toBe(base);
    expect(withRange(base, "A1&x=1")).toBe(base);
    expect(withRange(base, "a1")).toBe(base);
  });

  it("carries the calendar kind on a sheet", () => {
    expect(sheetEmbed(ID, "42", "planning")?.today).toBe("planning");
  });
});
