import { describe, expect, it } from "vitest";
import { phoneTourSteps } from "./phone-tour-steps";

const ALL = ["mail", "time", "fleet", "settings", "planning", "fleetsheet", "roaddays"] as const;

describe("phoneTourSteps", () => {
  it("walks home cards → tabs → day logging → install, in that order", () => {
    const keys = phoneTourSteps([...ALL]).map((step) => step.key);
    expect(keys).toEqual([
      "welcome",
      "avatar",
      "tile-overtime",
      "tile-today",
      "card-with-you",
      "tile-mail",
      "tiles-sheets",
      "tabs",
      "tab-time",
      "tab-mail",
      "tab-fleet",
      "tab-chat",
      "log-pick",
      "log-fill",
      "log-quick",
      "log-type",
      "install-safari",
      "install-add",
      "install-done",
    ]);
  });

  it("drops the Mail, Fleet and sheet steps the role does not have", () => {
    const keys = phoneTourSteps(["time", "settings"]).map((step) => step.key);
    expect(keys).not.toContain("tab-mail");
    expect(keys).not.toContain("tile-mail");
    expect(keys).not.toContain("tab-fleet");
    expect(keys).not.toContain("card-with-you");
    expect(keys).not.toContain("tiles-sheets");
    expect(phoneTourSteps(["time", "fleet", "settings"]).find((step) => step.key === "tabs")?.title).toMatch(/^Three/);
  });

  it("has no separate Save step: the quick fills save on their own", () => {
    const steps = phoneTourSteps([...ALL]);
    expect(steps.some((step) => step.key === "log-save")).toBe(false);
    expect(steps.find((step) => step.key === "log-quick")?.body).toMatch(/save on their own/);
  });

  it("gives every step a unique key and a spot", () => {
    const steps = phoneTourSteps([...ALL]);
    expect(new Set(steps.map((step) => step.key)).size).toBe(steps.length);
    for (const step of steps) expect(step.spot).toBeTruthy();
  });
});
