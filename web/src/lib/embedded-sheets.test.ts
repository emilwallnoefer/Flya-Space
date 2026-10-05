import { describe, expect, it } from "vitest";
import { canSeeEmbeddedSheets, sheetEmbedUrls } from "./embedded-sheets";

// Made up: the real ids live in env (GOOGLE_SHEETS_SPREADSHEET_ID, FLEET_SHEET_ID), and this repo is public.
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

describe("canSeeEmbeddedSheets", () => {
  it("shows the sheets to pilots and admins only", () => {
    expect(canSeeEmbeddedSheets("eu_pilot", false)).toBe(true);
    expect(canSeeEmbeddedSheets("us_pilot", false)).toBe(true);
    expect(canSeeEmbeddedSheets("sales", false)).toBe(false);
    expect(canSeeEmbeddedSheets("hr", false)).toBe(false);
    expect(canSeeEmbeddedSheets(null, false)).toBe(false);
  });

  it("shows them to admins whatever role they hold", () => {
    expect(canSeeEmbeddedSheets("sales", true)).toBe(true);
    expect(canSeeEmbeddedSheets("hr", true)).toBe(true);
    expect(canSeeEmbeddedSheets(null, true)).toBe(true);
  });
});

describe("sheetEmbedUrls", () => {
  it("embeds the editor with menus, on the configured tab", () => {
    const urls = sheetEmbedUrls(ID, "365898566")!;
    expect(urls.embed).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit?rm=embedded#gid=365898566`);
    expect(urls.open).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=365898566`);
  });

  it("signs in on Google and returns to the sheet", () => {
    const { signIn, open } = sheetEmbedUrls(ID, "365898566")!;
    const url = new URL(signIn);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("continue")).toBe(open);
  });

  it("falls back to the first tab when the gid is missing or not a number", () => {
    expect(sheetEmbedUrls(ID, undefined)!.embed).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit?rm=embedded`);
    expect(sheetEmbedUrls(ID, "abc")!.embed).not.toContain("gid");
  });

  it("returns null for a missing or malformed id, so the card stays hidden", () => {
    expect(sheetEmbedUrls(undefined, "1")).toBeNull();
    expect(sheetEmbedUrls("  ", "1")).toBeNull();
    expect(sheetEmbedUrls("../evil?x=", "1")).toBeNull();
  });
});
