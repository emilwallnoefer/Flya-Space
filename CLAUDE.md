# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Name

The product is **Flya Space** (served at `flya.space`). It was called "Flya Allrounder" before 2026-10-06 and "Mail Automator" before that; the old name survives only in external identifiers that are not worth breaking — the GitHub repo and local folder `Mail-Automator`, the Vercel project `mail-automator` (and its `mail-automator.vercel.app` alias and preview-URL pattern in the Supabase redirect allowlist), the Supabase project name, the GCP project `mail-automator-drafts`, the `@mail-automator.test` RLS-smoke accounts, and dated history (audit reports, runbooks). Use "Flya Space" in anything new.

## Repository layout

Two distinct subsystems live side-by-side:

1. **`web/`** — a Next.js 16 (App Router) + Supabase + Tailwind 4 dashboard. This is where almost all active development happens. It contains the Time Tracker, Mail Tracking, Admin module, Team Chat, Settings, Onboarding, and the Gmail draft-creation API used at runtime.
2. **`archive/mail-cli/`** — the retired Python `/mail` Cursor workflow, kept for reference only. Nothing imports or runs it; see `archive/mail-cli/README.md`. Its `training-links.json` carries two keys the web copy lacks, but both courses are offered by the web app via `industry-training-links.json` — a naming difference, nothing to port (closed 2026-07-26).

`Mail training cursor/` is local sample data and is git-ignored.

## Common commands

All `npm` commands run from `web/`.

Tests (run from `web/`): `npm run test` — Vitest unit suite (`src/**/*.test.ts`, colocated with sources); `npm run test:e2e` — Playwright smoke (`e2e/`, needs `.env.local` with the public Supabase vars and a one-time `npx playwright install chromium`); `npm run test:rls` — RLS smoke script. New pure-logic modules should get a colocated `*.test.ts`.

## Dependencies & CI

`.github/workflows/security-baseline.yml` is the only CI job. On every PR touching `web/**` it runs `npm ci`, `npm run lint`, then `npm audit --omit=dev --audit-level=high`. That last gate fails the **whole PR** on any high-severity advisory in a production dependency — including PRs that only touch markdown. A red check on an unrelated PR usually means the gate is failing on `main`, not that the PR broke something.

The same job also runs **daily at 06:00 UTC against `main`** (plus `workflow_dispatch`), so an advisory published against a version already shipping surfaces as its own failed run rather than on the next unrelated PR. If that scheduled run is red, fix it before anything else — every open PR is red until you do.

**Next.js is kept on the latest release, always.** It is pinned exactly in `web/package.json` (no `^`), and Dependabot proposes the bump weekly in a `next` group that carries `eslint-config-next` and `@next/*` with it — the two are version-locked, so never merge them apart. Review and merge that PR promptly rather than letting it sit; a stale pin is how the audit gate goes red. Dependabot also has security updates and vulnerability alerts enabled on the repo, so an advisory against the pinned version opens a PR on its own.

Dependabot writes the lockfile with its own npm, which may not be npm 10. If one of its PRs fails `npm ci` with `Missing: @emnapi/core@… from lock file`, don't debug the dependency — check the branch out and regenerate the lock per the first rule below.

Two rules when touching `web/package.json`:

- **Regenerate the lockfile with npm 10** by default, not whatever npm you have locally: `npx -y npm@10 install --package-lock-only`. The runner's Node 22 ships npm 10, and the two majors resolve nested optional platform packages differently (`@img/sharp-wasm32` + `@rolldown/binding-wasm32-wasi` both want `@emnapi/*`, one via a range and one via an exact pin). A lock written by npm 11 installs fine on macOS and then fails `npm ci` on the runner with `Missing: @emnapi/core@… from lock file`. Validate before pushing with `npx -y npm@10 ci --dry-run` against a copy of `package.json` + `package-lock.json`.
  - **npm 11 is an acceptable fallback when npm 10 cannot resolve the tree at all** — but only with the check below. npm 10's arborist walks into optional peers that npm 11 handles, and dies with `Cannot read properties of null (reading 'edgesOut')`; `vitest` hit this for months because `@vitest/browser-playwright` is an optional peer. That is a bug in the tool, not a reason to hold the dependency back. Regenerate with `npm install --package-lock-only`, then **confirm the `@emnapi/*` entries survived** (`node -e "const l=require('./package-lock.json');console.log(Object.keys(l.packages).filter(p=>p.includes('@emnapi')))"` — it must not be empty) and prove it with a real `npx -y npm@10 ci`, not just `--dry-run`. npm 11 drops those entries *sometimes*, which is what the rule above is guarding against; when they are present the lock is fine. Do not conclude a bump is impossible until you have tried this.
- **Never delete `package-lock.json` to regenerate it.** That re-resolves every semver range at once; the last time it silently pulled newer eslint plugins whose React Compiler rules flagged 34 pre-existing violations across the components. Use `--package-lock-only` so unrelated packages keep the resolution they had.

Vulnerabilities that live *inside* `next` (it vendors a pinned `postcss` and an optional `sharp`) can't be fixed by bumping next alone — npm will propose an absurd downgrade. Pin them in the `overrides` block in `web/package.json` instead.

## Big-picture architecture (`web/`)

### Auth & roles

- Supabase handles auth; the SSR client lives in `src/lib/supabase/server.ts` and the browser client in `client.ts`. `src/proxy.ts` (Next 16's rename of middleware) refreshes the session cookie and gates `/dashboard`, `/settings`, `/login` via `lib/supabase/middleware.ts`. It is not the only guard — both gated pages re-check the session server-side and redirect, so a proxy bypass exposes nothing.
- `src/lib/supabase/admin.ts` is `"server-only"` and holds the **service-role** client. It bypasses RLS — only call it after a successful `guardAdmin()` / `guardTimeViewer()` check.
- **Role resolution — roles live in `app_metadata.role` ONLY, never `user_metadata`.** `ADMIN_EMAILS` (env, comma-separated) → admin. Otherwise `app_metadata.role` ∈ {`sales`, `eu_pilot`, `us_pilot`, `hr`} (legacy `pilot` normalises to `eu_pilot`). Read it through `normalizeUserRole()` in `src/lib/user-role.ts`; the guards live in `src/lib/admin-guard.ts`. The invariant is enforced mechanically: an eslint `no-restricted-syntax` rule catches the direct spellings, and the AST guard in `src/lib/role-source.test.ts` catches aliased reads and `updateUser` writes that eslint cannot see.
  - `user_metadata` is **user-writable**: any signed-in user can rewrite it from the browser with `supabase.auth.updateUser()`. A role stored there is a role the user assigns to themselves, so **any check against `user_metadata.role` is a privilege-escalation bug**, not a style issue — that was the real hole SECURITY.md tracks as T0.1. Do not write one, and do not "restore" one because some older doc or comment mentions it.
  - `app_metadata` is writable only with the **service-role key**. That is why the one and only way a role changes is the `guardAdmin()`-protected `PATCH /api/admin/users` route, which writes it through the service-role client and audit-logs the change. No self-service role endpoint exists; do not add one.
  - `hr` is **admin-assigned only** and must never become self-selectable — it grants read-only access to the team-time endpoints via `guardTimeViewer()`, i.e. to every employee's time data.
  - `user_metadata` is still the right home for the user's *own* non-privilege preferences (theme, signature, travel-sheet mapping). The line is simple: if it decides what someone is allowed to do, it does not go there.
  - **Names follow the same rule.** A name that attributes something to a person (leaderboard, fleet history, holder claims, certificate requests) comes from `displayNameFor()` in `lib/fleet-queries.ts`, which reads the sign-in provider's `identities[].identity_data` and falls back to the email — never `user_metadata.full_name`, which the user can set to a colleague's name (SECURITY.md T0.15).
- **Every role is assigned by an admin.** `PATCH /api/admin/users` (behind `guardAdmin()`) is the only writer; there is no self-service picker. An account with no role never reaches the dashboard shell — `dashboard/page.tsx` renders `components/role-gate.tsx` instead (sign-out, and the Elios game to pass the time — no module code, no prefetch), and `/settings` redirects back to it. Admins are exempt, or nobody could lift the hold. **The page is not the boundary**: every non-admin API route must also call `forbidHeldAccount()` (`lib/app-access.ts`) after its session check, and every team-wide RLS policy must include `public.has_app_role()` (`supabase/2026-10-02-require-role.sql`) — a new route or policy without them reopens SECURITY.md T0.12. Only `/api/elios-score` and `/api/account/delete` are deliberately open to held accounts. The database reads the role from the token, so admins must hold a role too, and `lib/supabase/middleware.ts` reissues the token when a role changes. The first time a held account loads the dashboard, `lib/role-assignment-notice.ts` mails `ADMIN_EMAILS` exactly once: it claims a row in `role_assignment_notices` (PK on `user_id`) *before* calling Resend, so retries and concurrent tabs cannot double-send. Migration: `supabase/2026-09-15-role-assignment-notice.sql`. Delivery is best-effort — a Resend outage logs a warning and leaves the user blocked, which is the safe state.
- All `/api/admin/*` routes must start with `guardAdmin()` or `guardTimeViewer()` before touching the service-role client. This is the single most important security invariant.
- **Only `@flyability.com` accounts can be created**, enforced by a Supabase Auth *Before User Created* hook (`public.hook_restrict_signup_domain`, `supabase/2026-10-02-restrict-signup-domain.sql`, switched on under Authentication → Hooks). The check in `app/auth/callback/route.ts` is only a second layer: it runs after the account exists, so on its own it never stopped anyone. If the allowed domain changes, change both. The hook also blocks new `@mail-automator.test` accounts for `rls-smoke.mjs`; disable it while creating one.

### Modules & where to look

- **Mail Tracking** — admin-only; module in `components/mail-tracking/` (panel + `tabs/` + `charts/`), with `components/mail-tracking-panel.tsx` as a re-export shim. Mounted lazily by `admin-panel.tsx` under the "Mail tracking" section. Server engine in `lib/mail-engine.ts`. Public redirector at `app/r/[id]/` records clicks. Migrations: `supabase/2026-05-06-mail-link-tracking*.sql`, `2026-05-12-mail-click-timeline.sql`. All read paths **exclude `mail_sends.mail_type = 'pre'`**: pre-training mails render no link blocks, so they can never be clicked and would only dilute the click rates. The filter lives in the RPCs (`supabase/2026-07-26-mail-tracking-exclude-pre.sql`) — carry it forward when re-creating any of them.
- **Team Chat** — `components/chat-widget.tsx`, server logic in `lib/chat.ts`, `app/api/chat/`. Uses Supabase Realtime (`postgres_changes` on `chat_messages` + `chat_message_votes`) and the private `chat-attachments` Storage bucket. Migrations: `supabase/2026-04-19-team-chat*.sql`, `2026-08-07-chat-certificate-request.sql`. The composer's "Certificate" slot opens a structured form (`components/chat/certificate-request-modal.tsx`) posted to `app/api/chat/certificate-request/`; that route is the **only** writer of `certificate_request` rows — it derives the trainer from the session, renders the summary via `lib/certificate-request.ts`, and mails `ADMIN_EMAILS` through Resend. The `change_request` kind is retired but deliberately still accepted by the DB constraint and still rendered, so old rows survive; don't remove it.
- **Fleet (beta)** and **the Elios game** ("Fly where people can't", incl. the offline service worker) — their invariants live in `.claude/rules/fleet.md` and `.claude/rules/elios-game.md`, which load automatically when you touch those files. Read them before changing either module.
- **Field stats** — open panel at the bottom of the workspace home (below the fold, mounted on scroll by `FieldStatsOnScroll` in `dashboard-shell.tsx`) for every role: regions, POCs/trainings per pilot and travel days, computed from the "Mission planning" tab of the planning spreadsheet (`GOOGLE_SHEETS_SPREADSHEET_ID`/`GOOGLE_SHEETS_GID`) from 2026-01-01 up to yesterday (today and later are plans, not counted). Pure parsing + classification rules in `lib/field-stats.ts` (covered by `field-stats.test.ts` — fix a miscounted cell there); the sheet read + 10-min per-instance cache in `lib/field-stats-sheet.ts`, using the Google connection of the admin chosen in Admin → Field stats. Region = the salesperson in "Reporting to", mapped by admins. `/api/field-stats` returns the counts to every role, and the counted entries (so clicking a name lists them) only to pilots and admins (`canSeeFieldStatsDetail`) — sales and HR get counts only, because entries carry customer names and pilots' personal notes (owner decision, 2026-10-06). Never uncounted cells. The source token must belong to someone still in `ADMIN_EMAILS`. Settings table: `supabase/2026-10-05-field-stats-settings.sql` (service-role only).
- **Google embeds: Mission planning, Fleet management, Road Days** — home cards (no menu items) for `eu_pilot`/`us_pilot` and admins only, each a full-window view of Google's own UI in an iframe (`components/google-embed-panel.tsx`): sheets as `edit?rm=embedded`, the form as `viewform?embedded=true`. Mission planning is the planning sheet tab above (`GOOGLE_SHEETS_SPREADSHEET_ID`/`GOOGLE_SHEETS_GID`); Fleet management is `FLEET_SHEET_ID`/`FLEET_SHEET_GID`; Road Days is the form `ROAD_DAYS_FORM_ID` — ids in env because the repo is public, and an unset id hides that card. Nothing passes through our server — Google's sharing decides who can edit or answer, and it records who did. `dashboard/page.tsx` builds the URLs (`lib/google-embeds.ts`) only for allowed roles, so no other role receives them. CSP `frame-src` allows `https://docs.google.com` for this; Google sign-in refuses framing, so the panel opens it in a new tab, and Safari/Firefox may withhold the Google session from the frame ("Open in Google Sheets" is the fallback). Those fixes sit behind a quiet "Not loading?" link: the page cannot see into the cross-origin frame to know whether they are needed, so they stay out of the way until asked for.
- **Weekly reminder cron** — `app/api/cron/time-log-reminder/route.ts`. Triggered by Vercel Cron (see `web/vercel.json`) at 07:00 + 08:00 UTC every Monday; the route gates internally to "Monday 09:00 Europe/Zurich" so exactly one of the two runs work year-round across DST. Sends via Resend; audit rows in `time_log_reminder_sends`. Auth: `Authorization: Bearer ${CRON_SECRET}` from Vercel, or an admin session for manual invocations. Useful query params: `?preview=html|text`, `?send_test=<email>`, `?dry=1&force=1`, `?force=1`.

### Supabase migrations

`web/supabase/` is a **flat** directory of `.sql` files, mostly dated (`YYYY-MM-DD-...sql`). They are not orchestrated by the Supabase CLI in this repo — apply them in order by hand against the project. When adding schema changes, write a new dated file; do not edit historical ones. RLS policies are part of the migrations; the service-role key is the only way to bypass them and is gated as described above.

**Function grants: `revoke ... from public` is not enough on Supabase.** Supabase grants EXECUTE on functions in `public` to `anon` and `authenticated` *by name*, and a revoke from PUBLIC leaves those grants standing — which is how eight admin RPCs were callable with the bare anon key until `2026-09-29-rpc-revoke-anon-execute.sql` (SECURITY.md T0.10). That migration also changed the default so a function `postgres` creates now starts with **no** EXECUTE for anyone. So every new function must grant exactly what it needs, and name the roles it revokes:
- service-role-only RPC: `revoke execute on function f(...) from public, anon, authenticated; grant execute on function f(...) to service_role;`
- a user's own-data RPC, or a helper an RLS policy calls: `revoke ... from public, anon; grant ... to authenticated;` — a policy runs its helper as the querying role, so forgetting this grant makes every query the policy guards fail with "permission denied for function".
- `SECURITY DEFINER` bypasses RLS, so it must check `auth.uid()` itself. A null `auth.uid()` means *either* service_role/a trigger *or* anon; treating it as trusted (as `tt_refresh_overtime_bank_stats` does) is only safe while anon's EXECUTE is revoked.

`npm run test:rls` (check 7) probes the known RPCs with the anon key; add any new RPC to that list.

## Environment

Required env (dev: a gitignored dotenv in `web/` — this checkout uses `web/.env`, and Next loads `.env` and `.env.local` alike, so check which one exists before telling anyone a var is missing; prod: the hosting platform):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; bypasses RLS. Referenced only from `lib/supabase/admin.ts`.
- `ADMIN_EMAILS` — comma-separated; case-insensitive.
- `ANTHROPIC_API_KEY` — server-only; used by mail **Brief mode** (`/api/generate-brief` → `lib/mail-brief-llm.ts`) to have Claude write an email from a free-text brief. Referenced only from `lib/mail-brief-llm.ts` (`"server-only"`). If unset, Brief mode errors; the structured `/api/generate` path is unaffected. The Brief-mode model is chosen by admins in the dashboard (Admin → Mail & AI → "Mail brief model", `components/admin-mail-settings.tsx`), stored in `workspace_settings.mail_brief_model` and read by `/api/generate-brief`; optional env `MAIL_BRIEF_MODEL` is only a fallback, and the built-in default is `claude-opus-4-8` (allowlist in `lib/mail-brief-model.ts`).
- `RESEND_API_KEY`, `RESEND_FROM`, optional `RESEND_REPLY_TO` — reminder emails.
- `CRON_SECRET` — Vercel Cron bearer token. If unset, only admin sessions can hit cron routes.
- `GOOGLE_SHEETS_*` — travel-sheet integration for the Time Tracker (`lib/google-sheets.ts`); the id/gid also drive the Mission planning embed.
- `FLEET_SHEET_ID`, optional `FLEET_SHEET_GID` — the Fleet management sheet embedded for pilots/admins (`lib/google-embeds.ts`). Unset → no card.
- `ROAD_DAYS_FORM_ID` — the Road Days Google Form (the id after `/forms/d/e/`, not the URL), embedded for pilots/admins. Unset → no card.
- `TRACKING_SALT` — server-only; a long random string (≥16 chars enforced, ≥32 recommended). `app/r/[id]/route.ts` stores a SHA-256 of each clicking recipient's IP in `mail_link_clicks`, and this salt is the only thing that makes the hash irreversible: the IPv4 space is small enough to brute-force an unsalted SHA-256 in seconds. Those are **external recipients'** IPs — third-party personal data — which is why `supabase/2026-05-06-mail-link-tracking.sql` promises they are never recoverable. It now **fails closed**: `lib/security/tracking-salt.ts` resolves the salt once at module scope (blank/whitespace-only counts as unset), and there is no code path that hashes without one. In a deployed environment (`VERCEL_ENV` `production`/`preview`, or `NODE_ENV=production` off-Vercel) a missing salt logs a `[tracking-salt]` error and **drops the click row entirely** — the recipient is still redirected, because a config mistake of ours must not break their link. Locally it logs a one-time notice and records the click with a null `ip_hash`. Set it in every environment that serves `/r/<id>`, and treat it as a secret. Rotating it is safe but resets click de-duplication — old hashes stop matching new ones.
- Optional `APP_BASE_URL` — overrides dashboard link embedded in reminder emails.

The `web/README.md` has the most detailed env-var reference and the cron/team-chat operational notes; treat it as the source of truth before this file.

### Function region — do not remove

`web/vercel.json` pins `"regions": ["dub1"]` so functions run in the same AWS region as the Supabase project (eu-west-1). Never remove it, and if the database ever moves, move this with it. Rationale, measurements and the region mapping: `.claude/rules/vercel-region.md`.

## Conventions worth knowing

- `"server-only"` is used to keep admin/service code off the client bundle — preserve it when refactoring.
- **Nothing always on screen may animate forever.** The underwater skin (`aurora-bg`, `glass-card`, `liquid-day-card`, `underwater-panel`) is large blurred, blend-moded layers under `backdrop-filter` glass; one perpetual animation anywhere on top of it makes the browser recomposite the whole stack every display frame. The old drift/sweep/bubble animations held a full core in the GPU process while the dashboard sat idle — removing them took that to zero. Motion should be finite feedback that runs once and stops; loading pulses are fine because they end. A canvas loop (the Elios game) must drop its rate when nothing is happening and stop when off-screen.
- **The dashboard skeleton must match the workspace home, every time.** `app/dashboard/loading.tsx` is drawn from the same classes and card copy as the real home (`components/workspace-home-layout.ts`, used by `dashboard-shell.tsx` and `auth-navbar.tsx`). Change the home's layout or copy there, not inline, and when the home gains or loses a block, add or remove its placeholder in `loading.tsx` in the same change. Navbar and hero must stay direct children of `.page-shell` in both (its flex gap spaces them). Verify by measuring both pages' block positions at desktop and phone width — they should be identical.
- Many UI panels are large client components (`"use client"`) that mount inside the SSR'd `dashboard/page.tsx`. Initial-data props from the server are deliberately prefetched to avoid a flash on first paint — keep that pattern when adding new modules.
- Mail templates and link policies used at runtime live in `web/src/mail-config/` (`training-email-templates.md`, `*.json`), consumed by `web/src/lib/mail-engine.ts` via `/api/generate`. Older copies under `archive/mail-cli/` belong to the retired Python CLI and are **not** read by the web app — edit the `web/src/mail-config/` ones.
- The retired `/mail` command's hard rule — never auto-send, never create a draft before an explicit `confirm draft` — still applies to any equivalent flow in this repo, including the web app's Gmail draft creation.

## Housekeeping (do this without being asked)

Handle these when they come up — right after a merge, or when a session notices the state is stale. Do not queue them up for the user to prompt. Every step has a verification that comes **first**; report what you verified alongside what you removed.

**After a PR you opened gets merged**

1. Fast-forward the primary checkout: `git pull --ff-only`. A squash merge always leaves it behind, and the next session then reads stale files.
2. Delete the branch locally and on `origin`. Squash merges mean the branch's own commits are absent from `main`, so `git branch -d` refuses and `git worktree`/`ExitWorktree` warn about "unmerged" commits — that warning is expected, not a reason to keep the branch. Confirm the content landed with `git diff --stat origin/main <branch>` (must print nothing), then use `-D`.
3. Remove the worktree you created (`ExitWorktree` with `action: "remove"`), gated on a clean `git status` plus the same empty diff.

**Orphaned worktree directories**

`.claude/worktrees/` accumulates leftovers from past sessions that `git worktree list` no longer knows about — their gitdir was pruned, so git can tell you *nothing* about them and "the branch is gone" proves nothing either. Each is typically 0.2–1.2 GB of `node_modules`. Prove a directory holds no unique work before deleting it, by hashing every source file and looking the hash up in the object database:

```bash
find "<dir>" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.sql" -o -name "*.md" -o -name "*.json" -o -name "*.css" \) \
  -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.git/*" |
  while IFS= read -r f; do h=$(git hash-object "$f"); git cat-file -e "$h" 2>/dev/null || echo "UNIQUE: $f"; done
```

Only `web/next-env.d.ts` (Next generates it) and `.claude/settings.local.json` (machine-local) are expected to come back unique. **Anything else means unpushed work — stop and ask.** Also check for a dotenv inside the directory before removing it; if the primary checkout has none, that copy may be the only one. `rm -rf` has no undo.

**Out of scope, always**

Never rewrite or delete anything on `main`/`origin/main`, never force-push, and leave `archive/` as the historical snapshot it is — differences from `web/src/mail-config/` there are expected and are not yours to reconcile.

## Release notes ("What's new" popup)

When you commit/merge/push a **user-facing** feature, add a `RELEASE_NOTES` entry in the same change (`web/src/lib/release-notes.ts`) — otherwise the dashboard "What's new" popup won't surface it. Prepend it to the array (the first element, `LATEST_RELEASE`, is what renders): `version` = today's `YYYY-MM-DD` (a new version is what re-fires the popup), a human `date`, a short `title`, and a few terse `highlights`. Skip only purely internal changes (refactors/CI/docs).
