import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Mail, Time Tracker and Fleet route refuses the roles without that
 * module (lib/role-access.ts). The dashboard only hides the module; these
 * checks are what stop a direct call, so this pins that each route still
 * makes one per handler. A new route for one of these modules belongs here.
 */
const SRC = path.resolve(__dirname, "..");

const GATED: Array<{ file: string; module: "mail" | "time" | "fleet"; checks: number }> = [
  { file: "app/api/generate/route.ts", module: "mail", checks: 1 },
  { file: "app/api/generate-brief/route.ts", module: "mail", checks: 1 },
  { file: "app/api/render-brief/route.ts", module: "mail", checks: 1 },
  { file: "app/api/gmail/connect/route.ts", module: "mail", checks: 1 },
  { file: "app/api/gmail/callback/route.ts", module: "mail", checks: 1 },
  { file: "app/api/gmail/create-draft/route.ts", module: "mail", checks: 1 },
  { file: "app/api/gmail/status/route.ts", module: "mail", checks: 1 },
  { file: "app/api/settings/mail-generation/route.ts", module: "mail", checks: 2 },
  { file: "app/api/time-tracker/route.ts", module: "time", checks: 1 },
  { file: "app/api/time-tracker/handlers/get-week.ts", module: "time", checks: 1 },
  { file: "app/api/settings/travel-mapping/route.ts", module: "time", checks: 3 },
  { file: "app/api/settings/fleet-notices/route.ts", module: "fleet", checks: 2 },
];

function count(source: string, needle: RegExp): number {
  return source.match(needle)?.length ?? 0;
}

describe("module routes refuse roles without the module", () => {
  it.each(GATED)("$file checks $module", ({ file, module, checks }) => {
    const source = readFileSync(path.join(SRC, file), "utf8");
    const calls = count(source, new RegExp(`forbidWithoutModule\\(\\w+, "${module}"\\)`, "g"));
    expect(calls).toBe(checks);
  });

  it("every exported handler in those route files is covered", () => {
    for (const { file, checks } of GATED) {
      if (!file.endsWith("route.ts") || file === "app/api/time-tracker/route.ts") continue;
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(count(source, /export async function (GET|POST|PUT|PATCH|DELETE)\b/g), file).toBe(checks);
    }
  });

  it("the Fleet route checks the role on both its handlers", () => {
    const source = readFileSync(path.join(SRC, "app/api/fleet/route.ts"), "utf8");
    expect(count(source, /if \(!viewer\.canUseFleet\)/g)).toBe(2);
    expect(count(source, /export async function (GET|POST)\b/g)).toBe(2);
  });

  it("the time-tracker GET goes through the gated week handler", () => {
    const source = readFileSync(path.join(SRC, "app/api/time-tracker/route.ts"), "utf8");
    expect(source).toMatch(/export async function GET\(request: Request\) \{\n\s+return handleGetWeek\(request\);/);
  });
});
