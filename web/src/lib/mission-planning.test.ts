import { describe, expect, it } from "vitest";
import { canSeeMissionPlanning, missionPlanningUrls } from "./mission-planning";

// Made up: the real id lives in GOOGLE_SHEETS_SPREADSHEET_ID, and this repo is public.
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

describe("canSeeMissionPlanning", () => {
  it("shows the sheet to pilots and admins only", () => {
    expect(canSeeMissionPlanning("eu_pilot", false)).toBe(true);
    expect(canSeeMissionPlanning("us_pilot", false)).toBe(true);
    expect(canSeeMissionPlanning("sales", false)).toBe(false);
    expect(canSeeMissionPlanning("hr", false)).toBe(false);
    expect(canSeeMissionPlanning(null, false)).toBe(false);
  });

  it("shows it to admins whatever role they hold", () => {
    expect(canSeeMissionPlanning("sales", true)).toBe(true);
    expect(canSeeMissionPlanning("hr", true)).toBe(true);
    expect(canSeeMissionPlanning(null, true)).toBe(true);
  });
});

describe("missionPlanningUrls", () => {
  it("embeds the editor with menus, on the configured tab", () => {
    const urls = missionPlanningUrls(ID, "365898566")!;
    expect(urls.embed).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit?rm=embedded#gid=365898566`);
    expect(urls.open).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=365898566`);
  });

  it("signs in on Google and returns to the sheet", () => {
    const { signIn, open } = missionPlanningUrls(ID, "365898566")!;
    const url = new URL(signIn);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("continue")).toBe(open);
  });

  it("falls back to the first tab when the gid is missing or not a number", () => {
    expect(missionPlanningUrls(ID, undefined)!.embed).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit?rm=embedded`);
    expect(missionPlanningUrls(ID, "abc")!.embed).not.toContain("gid");
  });

  it("returns null for a missing or malformed id, so nothing broken is framed", () => {
    expect(missionPlanningUrls(undefined, "1")).toBeNull();
    expect(missionPlanningUrls("  ", "1")).toBeNull();
    expect(missionPlanningUrls("../evil?x=", "1")).toBeNull();
  });
});
