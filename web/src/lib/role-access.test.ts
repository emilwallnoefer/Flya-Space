import { describe, expect, it } from "vitest";
import { availableModulesFor, canUseModule } from "./role-access";

const ALL_EMBEDS = { planning: true, fleetsheet: true, roaddays: true };
const NO_EMBEDS = { planning: false, fleetsheet: false, roaddays: false };

describe("availableModulesFor", () => {
  it("sales: Fleet and the Google sheets, no Time Tracker or Mail", () => {
    expect(availableModulesFor("sales", false, ALL_EMBEDS)).toEqual([
      "fleet",
      "settings",
      "planning",
      "fleetsheet",
      "roaddays",
    ]);
  });

  it("EU pilot: Mail, Time, Fleet and the Google sheets", () => {
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
    expect(availableModulesFor("sales", false, { ...NO_EMBEDS, roaddays: true })).toEqual([
      "fleet",
      "settings",
      "roaddays",
    ]);
  });

  it("no role: nothing but settings", () => {
    expect(availableModulesFor(null, false, ALL_EMBEDS)).toEqual(["settings"]);
  });
});

describe("canUseModule", () => {
  const cases: Array<[Parameters<typeof canUseModule>[0], boolean, { mail: boolean; time: boolean; fleet: boolean }]> = [
    ["sales", false, { mail: false, time: false, fleet: true }],
    ["eu_pilot", false, { mail: true, time: true, fleet: true }],
    ["us_pilot", false, { mail: true, time: true, fleet: false }],
    ["hr", false, { mail: false, time: false, fleet: false }],
    [null, false, { mail: false, time: false, fleet: false }],
    ["hr", true, { mail: true, time: true, fleet: true }],
    [null, true, { mail: true, time: true, fleet: true }],
  ];
  it.each(cases)("%s (admin: %s)", (role, isAdmin, expected) => {
    expect({
      mail: canUseModule(role, isAdmin, "mail"),
      time: canUseModule(role, isAdmin, "time"),
      fleet: canUseModule(role, isAdmin, "fleet"),
    }).toEqual(expected);
  });
});
