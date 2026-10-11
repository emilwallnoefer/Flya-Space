import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard: the user's ROLE may never be read out of `user_metadata`.
 *
 * Supabase gives every account two metadata bags:
 *
 *   - `user_metadata` — the user rewrites it themselves with the anon key via
 *     `supabase.auth.updateUser()`. It is also inside their JWT.
 *   - `app_metadata`  — only the service-role key can write it.
 *
 * A role read from `user_metadata` therefore means any employee can self-assign
 * `hr` and reach every other employee's day-level time and onboarding data
 * through `guardTimeViewer()`. That was SECURITY.md T0.1 (fixed), and run-3 F7
 * (`dashboard/page.tsx`, fixed). The unit tests next door prove the *current*
 * `guardAdmin` / `guardTimeViewer` / `normalizeUserRole` behave; this file is
 * what stops the invariant being re-broken by a file that does not exist yet.
 *
 * What it does NOT ban is `user_metadata` itself — that bag is the right home
 * for the user's own non-privilege preferences (travel-sheet column mapping,
 * appearance theme, Gmail display address). Only the `role`
 * field is privileged, so only reads of `role` are flagged.
 *
 * The scan runs over the TypeScript AST rather than raw text, which is why a
 * comment or a string that merely mentions `user_metadata.role` — including the
 * ones in this file — cannot trip it.
 */

const SRC = path.resolve(__dirname, "..");

/** The field that decides privilege. Everything else in the bag is preference data. */
const ROLE_FIELD = "role";

/**
 * Names that mean "this value came out of the user-writable bag". A file that
 * lifts the bag into a local (`const userMetadata = claims.user_metadata`) is
 * tracked by the taint pass below; these cover the direct spellings.
 */
const USER_BAG = /user_metadata|userMetadata/;
const APP_BAG = /app_metadata|appMetadata/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      // `src/test/` holds fakes and harnesses whose whole job is to build
      // fake user objects; they never make an authorization decision.
      if (full === path.join(SRC, "test")) continue;
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

type Violation = { file: string; line: number; snippet: string; kind: "read" | "write" };

/**
 * KNOWN, TRACKED VIOLATIONS — not an allowlist, a debt register.
 *
 * Every entry here is a line that breaks the invariant and is waiting on a
 * decision, NOT a blessed pattern. The test asserts the set matches exactly, so
 * the list can never grow silently and a fix that leaves a stale entry behind
 * fails just as loudly as a new violation would. Copying an entry to excuse a
 * new line is the one thing this file exists to prevent.
 *
 * It is EMPTY, and empty is the goal state: no file under `src/` reads or
 * writes a role through `user_metadata`. The last entry was the first-login
 * role picker in `components/dashboard-shell.tsx` — that picker is gone, roles
 * are assigned by an admin through the guardAdmin()-protected
 * PATCH /api/admin/users, and an account with no role is held on the RoleGate
 * until one is. Keep it empty.
 */
const KNOWN_VIOLATIONS: string[] = [];

/**
 * Flags every read of a `role` field off a value that came from
 * `user_metadata`, following one level of aliasing:
 *
 *   user.user_metadata.role                       // direct
 *   claims.user_metadata?.["role"]                // computed
 *   const m = user.user_metadata as Record<…>;    // aliased…
 *   normalizeUserRole(m.role)                     // …then read
 *   const { role } = user.user_metadata           // destructured
 *   "role" in m                                   // probed
 *
 * ...and every WRITE of a role into the same bag, which is the more detectable
 * half and the thing that would make a future reader dangerous:
 *
 *   supabase.auth.updateUser({ data: { role: next } })   // anon-key writable
 *
 * `app_metadata` reads are never flagged, and neither is any other field of
 * `user_metadata`. `updateUser({ data: … })` without a `role` key is likewise
 * fine — that is how appearance and gmail_email are stored.
 */
export function findRoleReadsFromUserMetadata(fileName: string, source: string): Violation[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: Violation[] = [];

  // Pass 1 — which local names hold the user-writable bag?
  const tainted = new Set<string>();
  const taint = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = node.initializer.getText(sf);
      if (USER_BAG.test(init) && !APP_BAG.test(init)) tainted.add(node.name.text);
    }
    ts.forEachChild(node, taint);
  };
  ts.forEachChild(sf, taint);

  const report = (node: ts.Node, kind: "read" | "write" = "read") => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({
      file: fileName,
      kind,
      line: line + 1,
      snippet: node.getText(sf).replace(/\s+/g, " ").slice(0, 120),
    });
  };

  /** `{ role: … }` — shorthand, string key or computed-free named key. */
  const hasRoleProperty = (obj: ts.ObjectLiteralExpression) =>
    obj.properties.some((p) => {
      const name = p.name;
      if (!name) return false;
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text === ROLE_FIELD;
      return false;
    });

  /** Does this expression resolve to the user-writable bag (directly or via an alias)? */
  const isUserBag = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return tainted.has(expr.text);
    const text = expr.getText(sf);
    return USER_BAG.test(text) && !APP_BAG.test(text);
  };

  // Pass 2 — role reads off anything tainted.
  const scan = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === ROLE_FIELD && isUserBag(node.expression)) {
      report(node);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === ROLE_FIELD &&
      isUserBag(node.expression)
    ) {
      report(node);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      ts.isStringLiteralLike(node.left) &&
      node.left.text === ROLE_FIELD &&
      isUserBag(node.right)
    ) {
      report(node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isUserBag(node.initializer) &&
      node.name.elements.some(
        (el) =>
          (el.propertyName ? el.propertyName.getText(sf).replace(/["']/g, "") : el.name.getText(sf)) === ROLE_FIELD,
      )
    ) {
      report(node);
    } else if (
      // WRITE: supabase.auth.updateUser({ data: { role: … } }) — `data` is
      // user_metadata, and this call runs with the anon key in the browser.
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "updateUser") ||
        (ts.isIdentifier(node.expression) && node.expression.text === "updateUser")) &&
      node.arguments.some(
        (arg) =>
          ts.isObjectLiteralExpression(arg) &&
          arg.properties.some(
            (p) =>
              ts.isPropertyAssignment(p) &&
              p.name.getText(sf).replace(/["']/g, "") === "data" &&
              ts.isObjectLiteralExpression(p.initializer) &&
              hasRoleProperty(p.initializer),
          ),
      )
    ) {
      report(node, "write");
    }
    ts.forEachChild(node, scan);
  };
  ts.forEachChild(sf, scan);

  return violations;
}

const WHY = [
  "",
  "  The ROLE must come from `app_metadata`, never `user_metadata`.",
  "",
  "  `user_metadata` is rewritable by the user themselves with the anon key",
  "  (`supabase.auth.updateUser({ data: { role: 'hr' } })`). A role read from",
  "  there lets any employee self-assign `hr` and reach every other employee's",
  "  time and onboarding data via guardTimeViewer(). See SECURITY.md T0.1.",
  "",
  "  Do this instead — the shape used by admin-guard.ts, dashboard/page.tsx and",
  "  settings/page.tsx:",
  "",
  "    const bag =",
  "      user.app_metadata && typeof user.app_metadata === 'object' && !Array.isArray(user.app_metadata)",
  "        ? (user.app_metadata as Record<string, unknown>)",
  "        : {};",
  "    const role = normalizeUserRole(bag.role);",
  "",
  "  Only an admin may change a role, and only through the guardAdmin()-protected",
  "  PATCH /api/admin/users, which writes app_metadata with the service-role key.",
  "  A `[write]` hit means `updateUser({ data: { role } })` — that call runs with",
  "  the ANON key in the browser, so it is the user assigning their own role. Post",
  "  to a guarded server route instead; a client can never be trusted with this.",
  "",
  "  Other `user_metadata` fields (travel-sheet mapping, appearance,",
  "  gmail_email) are fine and deliberately not flagged — only `role` is.",
].join("\n");

describe("role source", () => {
  const files = collectSourceFiles(SRC);

  it("scans a non-trivial number of source files", () => {
    // Guards the guard: a broken walker that finds nothing would pass silently.
    expect(files.length).toBeGreaterThan(50);
  });

  const violations = files.flatMap((file) =>
    findRoleReadsFromUserMetadata(file, readFileSync(file, "utf8")).map((v) => ({
      ...v,
      file: path.relative(SRC, v.file),
    })),
  );

  it("no file under src/ reads or writes a role via user_metadata", () => {
    const fresh = violations.filter((v) => !KNOWN_VIOLATIONS.includes(v.file));

    if (fresh.length > 0) {
      throw new Error(
        [
          `The role reaches the user-writable metadata bag in ${fresh.length} new place${fresh.length === 1 ? "" : "s"}:`,
          ...fresh.map((v) => `    src/${v.file}:${v.line}  [${v.kind}]  ${v.snippet}`),
          WHY,
        ].join("\n"),
      );
    }
    expect(fresh).toEqual([]);
  });

  it("the tracked known violations are still exactly the ones on the register", () => {
    // Shrink-only: a fixed file must be removed from KNOWN_VIOLATIONS, and a new
    // one can never be added without a reviewer reading the comment above it.
    //
    // With the register empty this reads as "no file violates the invariant at
    // all" — still a real assertion, and the strictest the register can be. It
    // is deliberately NOT the same check as the test above: that one ignores
    // registered files, this one refuses to let any file be registered.
    const offending = [...new Set(violations.map((v) => v.file))].sort();
    expect(
      offending,
      "KNOWN_VIOLATIONS is a debt register, not an allowlist — if a file no longer violates the invariant, delete its entry.",
    ).toEqual([...KNOWN_VIOLATIONS].sort());
  });

  it("catches every shape of the violation it is meant to catch", () => {
    const shapes = [
      "const role = normalizeUserRole(user.user_metadata.role);",
      'const role = claims.user_metadata?.["role"];',
      "const m = user.user_metadata as Record<string, unknown>;\nconst role = normalizeUserRole(m.role);",
      "const { role } = user.user_metadata;",
      "const m = claims.user_metadata ?? {};\nif ('role' in m) grant();",
      "const meta = data.user_metadata;\nexport const isHr = meta.role === 'hr';",
      // Writes, not just reads — the self-assignment half.
      "await supabase.auth.updateUser({ data: { role: nextRole } });",
      "await supabase.auth.updateUser({ data: { role } });",
      "await client.auth.updateUser({ data: { 'role': 'hr' } });",
    ];
    for (const shape of shapes) {
      expect(findRoleReadsFromUserMetadata("f.ts", shape), shape).not.toHaveLength(0);
    }
  });

  it("leaves the legitimate non-privilege uses of user_metadata alone", () => {
    const allowed = [
      // handlers/shared.ts — travel-sheet column mapping (preferences).
      "const metadata = rawMetadata as Record<string, unknown>;\nconst rawMapping = metadata.travel_sheet_mapping;",
      // ...and the deliberate dropping of the user-writable range/gid.
      "const m = user.user_metadata as Record<string, unknown>;\nconst ignored = [m.range, m.gid];",
      // layout.tsx — appearance.
      "const meta = claims.user_metadata;\nconst t = meta.appearance_theme;",
      // gmail/callback — display address.
      "const gmail = String(user.user_metadata?.gmail_email ?? '');",
      // chat/certificate-request — trainer display name.
      "const m = user.user_metadata as Record<string, unknown>;\nconst name = m.full_name;",
      // The correct source is never flagged, however it is spelled.
      "const role = normalizeUserRole(user.app_metadata.role);",
      'const bag = user.app_metadata as Record<string, unknown>;\nconst role = bag["role"];',
      // A comment or a string mentioning the ban must not trip it.
      "// never read user_metadata.role here\nconst note = 'user_metadata.role is banned';",
      // Writing a preference through updateUser is the supported path.
      "await supabase.auth.updateUser({ data: { appearance_theme: theme } });",
      "await supabase.auth.updateUser({ data: { ...user.user_metadata, gmail_email: connected } });",
      // The admin write goes to app_metadata with the service-role key.
      "await admin.auth.admin.updateUserById(id, { app_metadata: { role } });",
    ];
    for (const snippet of allowed) {
      expect(findRoleReadsFromUserMetadata("f.ts", snippet), snippet).toEqual([]);
    }
  });
});
