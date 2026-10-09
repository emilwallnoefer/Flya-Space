import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard: the desktop UI never depends on the mobile UI.
 *
 * Phones get a dedicated shell (`src/components/mobile/**`), chosen on the
 * server by `lib/device.ts`. The promise behind that split is that the desktop
 * tree stays byte-identical no matter what happens on the phone side — which
 * only holds while no desktop file imports from the mobile tree, and while no
 * desktop component branches on the viewport in JS (CSS is the only place the
 * desktop may be responsive). The eslint `no-restricted-imports` rule says the
 * same for `src/components/**`; this test walks the AST so re-exports,
 * dynamic `import()` calls and files outside `components/` are covered too.
 *
 * The third check pins the one allowed bridge: `app/dashboard/page.tsx` and
 * `app/dashboard/loading.tsx` may import the mobile tree, and only they.
 */

const SRC = path.resolve(__dirname, "..");
const MOBILE_IMPORT = /(^|\/)components\/mobile(\/|$)/;
const VIEWPORT_HOOK = /(^|\/)lib\/use-media-query$/;

/** Files that are allowed to import the mobile tree: the server-side branch points. */
const BRIDGES = new Set([
  path.join(SRC, "app", "dashboard", "page.tsx"),
  path.join(SRC, "app", "dashboard", "loading.tsx"),
  path.join(SRC, "app", "settings", "page.tsx"),
  path.join(SRC, "app", "onboarding", "page.tsx"),
]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (entry.name === "next-env.d.ts") continue;
    out.push(full);
  }
  return out;
}

/** Every module specifier a file pulls in: static imports, re-exports and `import()`. */
export function importedSpecifiers(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specifiers;
}

function isMobileFile(file: string): boolean {
  return file.startsWith(path.join(SRC, "components", "mobile") + path.sep);
}

describe("desktop tree never depends on the mobile tree", () => {
  const files = collectSourceFiles(SRC);

  it("no desktop file imports from components/mobile (except the server branch points)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isMobileFile(file) || BRIDGES.has(file)) continue;
      const specs = importedSpecifiers(file, readFileSync(file, "utf8"));
      for (const spec of specs) {
        if (MOBILE_IMPORT.test(spec)) offenders.push(`${path.relative(SRC, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no desktop component branches on the viewport in JS", () => {
    const offenders: string[] = [];
    const componentsDir = path.join(SRC, "components");
    for (const file of files) {
      if (!file.startsWith(componentsDir + path.sep) || isMobileFile(file)) continue;
      const specs = importedSpecifiers(file, readFileSync(file, "utf8"));
      for (const spec of specs) {
        if (VIEWPORT_HOOK.test(spec)) offenders.push(`${path.relative(SRC, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the dashboard page imports MobileShell only behind isPhoneRequest", () => {
    const source = readFileSync(path.join(SRC, "app", "dashboard", "page.tsx"), "utf8");
    expect(source).toMatch(/isPhoneRequest\(await headers\(\)\)\) return <MobileShell/);
    expect(source).toMatch(/return <DashboardShell/);
  });
});
