import { describe, expect, it } from "vitest";
import { availableModulesFor, canSeeGoogleEmbed, canSeeGoogleEmbeds, canUseModule } from "./role-access";

const ALL_EMBEDS = { planning: true, fleetsheet: true, roaddays: true };
const NO_EMBEDS = { planning: false, fleetsheet: false, roaddays: false };

describe("availableModulesFor", () => {
  it("sales: Fleet and the two Google sheets, no Road Days, Time Tracker or Mail", () => {
    expect(availableModulesFor("sales", false, ALL_EMBEDS)).toEqual(["fleet", "settings", "planning", "fleetsheet"]);
  });

  it("EU pilot: Mail, Time, Fleet and the Google sheets and form", () => {
    expect(availableModulesFor("eu_pilot", false, ALL_EMBEDS)).toEqual([
      "mail",
      "time",
      "fleet",
      "settings",
      "planning",
      "fleetsheet",
      "roaddays",
    ]);
  });

  it("US pilot: Mail and Time only, even when the sheets are configured", () => {
    expect(availableModulesFor("us_pilot", false, ALL_EMBEDS)).toEqual(["mail", "time", "settings"]);
  });

  it("HR: the team time view only, no own Time Tracker or Fleet", () => {
    expect(availableModulesFor("hr", false, ALL_EMBEDS)).toEqual(["settings", "admin"]);
  });

  it("admin: everything, whatever role they hold", () => {
    for (const role of ["sales", "eu_pilot", "us_pilot", "hr", null] as const) {
      expect(availableModulesFor(role, true, ALL_EMBEDS)).toEqual([
        "mail",
        "time",
        "fleet",
        "settings",
        "planning",
        "fleetsheet",
        "roaddays",
        "admin",
      ]);
    }
  });

  it("a sheet whose id is not configured is left out", () => {
    expect(availableModulesFor("eu_pilot", false, { ...NO_EMBEDS, roaddays: true })).toEqual([
      "mail",
      "time",
      "fleet",
      "settings",
      "roaddays",
    ]);
    expect(availableModulesFor("sales", false, { ...NO_EMBEDS, fleetsheet: true })).toEqual([
      "fleet",
      "settings",
      "fleetsheet",
    ]);
  });

  it("no role: nothing but settings", () => {
    expect(availableModulesFor(null, false, ALL_EMBEDS)).toEqual(["settings"]);
  });
});

describe("canSeeGoogleEmbed", () => {
  it("Road Days: EU pilots and admins only", () => {
    expect(canSeeGoogleEmbed("eu_pilot", false, "roaddays")).toBe(true);
    expect(canSeeGoogleEmbed("hr", true, "roaddays")).toBe(true);
    for (const role of ["sales", "us_pilot", "hr", null] as const) {
      expect(canSeeGoogleEmbed(role, false, "roaddays")).toBe(false);
    }
  });

  it("the planning and fleet sheets: also sales", () => {
    for (const embed of ["planning", "fleetsheet"] as const) {
      expect(canSeeGoogleEmbed("sales", false, embed)).toBe(true);
      expect(canSeeGoogleEmbed("eu_pilot", false, embed)).toBe(true);
      expect(canSeeGoogleEmbed("us_pilot", false, embed)).toBe(false);
      expect(canSeeGoogleEmbed("hr", false, embed)).toBe(false);
    }
  });

  it("canSeeGoogleEmbeds: any one of them", () => {
    expect(canSeeGoogleEmbeds("sales", false)).toBe(true);
    expect(canSeeGoogleEmbeds("us_pilot", false)).toBe(false);
  });
});

describe("canUseModule", () => {
  type Access = { mail: boolean; time: boolean; fleet: boolean; travel: boolean };
  const cases: Array<[Parameters<typeof canUseModule>[0], boolean, Access]> = [
    ["sales", false, { mail: false, time: false, fleet: true, travel: false }],
    ["eu_pilot", false, { mail: true, time: true, fleet: true, travel: true }],
    // US pilots log time but have no travel sheet: no Travel mapping, no Time data.
    ["us_pilot", false, { mail: true, time: true, fleet: false, travel: false }],
    ["hr", false, { mail: false, time: false, fleet: false, travel: false }],
    [null, false, { mail: false, time: false, fleet: false, travel: false }],
    ["hr", true, { mail: true, time: true, fleet: true, travel: true }],
    [null, true, { mail: true, time: true, fleet: true, travel: true }],
  ];
  it.each(cases)("%s (admin: %s)", (role, isAdmin, expected) => {
    expect({
      mail: canUseModule(role, isAdmin, "mail"),
      time: canUseModule(role, isAdmin, "time"),
      fleet: canUseModule(role, isAdmin, "fleet"),
      travel: canUseModule(role, isAdmin, "travel"),
    }).toEqual(expected);
  });
});
