import { describe, expect, it } from "vitest";
import { phoneTourSteps } from "./phone-tour-steps";

describe("phoneTourSteps", () => {
  it("walks home → tabs → day logging → install, in that order", () => {
    const keys = phoneTourSteps(["mail", "time", "fleet", "settings"]).map((step) => step.key);
    expect(keys).toEqual([
      "welcome",
      "tabs",
      "tab-time",
      "tab-mail",
      "tab-fleet",
      "tab-chat",
      "log-pick",
      "log-fill",
      "log-type",
      "log-save",
      "install-safari",
      "install-add",
      "install-done",
    ]);
  });

  it("drops the Mail tab step for roles without the Mail module", () => {
    const steps = phoneTourSteps(["time", "fleet", "settings"]);
    expect(steps.map((step) => step.key)).not.toContain("tab-mail");
    expect(steps.find((step) => step.key === "tabs")?.title).toMatch(/^Three/);
  });

  it("gives every step a unique key and a screen", () => {
    const steps = phoneTourSteps(["mail", "time", "fleet", "settings"]);
    expect(new Set(steps.map((step) => step.key)).size).toBe(steps.length);
    for (const step of steps) expect(step.screen).toBeTruthy();
  });
});
