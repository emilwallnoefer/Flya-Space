import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Treat a leading underscore as an explicit "intentionally unused" marker,
  // matching the convention used across the codebase (_request, _kind, etc.).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // The role must come from `app_metadata` (service-role writable only), never
  // `user_metadata`, which the user rewrites themselves with the anon key via
  // supabase.auth.updateUser(). See SECURITY.md T0.1, and the AST-level
  // architecture guard in src/lib/role-source.test.ts, which also follows the
  // aliased `const m = user.user_metadata` form these selectors cannot see.
  // Only `role` is restricted — the rest of user_metadata (travel-sheet
  // mapping, signature, appearance, gmail_email) is legitimate preference data.
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[property.name="role"][object.property.name="user_metadata"], MemberExpression[property.name="role"][object.name=/^(user_metadata|userMetadata)$/], MemberExpression[computed=true][property.value="role"][object.property.name="user_metadata"], MemberExpression[computed=true][property.value="role"][object.name=/^(user_metadata|userMetadata)$/], VariableDeclarator[init.property.name="user_metadata"] > ObjectPattern > Property[key.name="role"], VariableDeclarator[init.name=/^(user_metadata|userMetadata)$/] > ObjectPattern > Property[key.name="role"]',
          message:
            "Never read the role from user_metadata: the user can rewrite that bag themselves (supabase.auth.updateUser), so this would let any employee self-assign `hr` and read everyone else's time data. Read `app_metadata.role` and pass it through normalizeUserRole(); only PATCH /api/admin/users (behind guardAdmin) may write it. See SECURITY.md T0.1.",
        },
        {
          selector:
            'CallExpression[callee.property.name="updateUser"] > ObjectExpression > Property[key.name="data"] > ObjectExpression > Property[key.name="role"], CallExpression[callee.property.name="updateUser"] > ObjectExpression > Property[key.value="data"] > ObjectExpression > Property[key.value="role"]',
          message:
            "Never write a role through updateUser({ data: … }): `data` IS user_metadata and this call runs with the anon key in the browser, so it is the user assigning their own role. Roles are set only by PATCH /api/admin/users, which is behind guardAdmin() and writes app_metadata with the service-role key. See SECURITY.md T0.1.",
        },
      ],
    },
  },

  // The dedicated mobile UI lives in src/components/mobile/** and is chosen on
  // the server (lib/device.ts). The desktop tree must never reach into it, nor
  // branch on the viewport in JS: that is what keeps the desktop byte-identical
  // on every phone-side change. The AST guard in src/lib/desktop-tree.test.ts
  // checks the same from the other direction.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/mobile/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/mobile", "@/components/mobile/*", "@/components/mobile/**", "**/components/mobile/**"],
              message:
                "Desktop components must not import the mobile tree. The two shells share hooks and data, never markup; see the mobile masterplan and src/lib/desktop-tree.test.ts.",
            },
            {
              group: ["@/lib/use-media-query"],
              message:
                "Desktop components must not branch on the viewport in JS. Phone vs desktop is decided on the server (lib/device.ts); use CSS for anything responsive inside the desktop tree.",
            },
          ],
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
