# Security Masterplan — Mail Automator (`web/`)

_Last updated: 2026-09-29. Owner: admin. This document is the running plan for hardening the web app; update it as items ship._

> **Run-3 (2026-07-26)** added Tier 0 items **T0.6–T0.9** and Tier 1 items **T1.9–T1.11** from a
> third audit pass weighted to Postgres function privileges — the area runs 1 and 2 never
> examined. All run-3 findings are fixed on `worktree-security-audit-run3`; three migrations
> must be applied by hand. Artifacts: `docs/security-audit/run-3/`. The plain-language
> write-up of the whole posture is `docs/security-posture.md` (repo root).

## Context

This plan was produced from a deep security audit (Cloudflare `security-audit` skill pipeline; full artifacts in `~/security-audit-skill/mail-automator/run-1/`: `REPORT.md`, `FINDINGS-DETAIL` in `findings.json`) plus a paired feature request: **log the security events an admin needs to see, and email the admin on a likely breach.** The audit was a partial run (sub-agents hit a session rate limit) weighted toward access control, public endpoints, OAuth, and secrets — re-run it to widen coverage.

The core authorization invariant (`guardAdmin()`/`guardTimeViewer()` before any service-role use) holds. The real weaknesses are **where trust and secrets are stored** (Supabase `user_metadata`, which the browser can read and write) and an **unauthenticated paid-LLM endpoint**. Tier 2 adds the detection + alerting layer the app currently lacks entirely.

## Priority tiers

Each item: **what** · **impact** · **fix** · **effort**.

### Tier 0 — Fix now (confirmed, exploitable)

**T0.1 — Privilege escalation to `hr` via self-writable `user_metadata.role`** _(HIGH)_
- **What:** roles live in `user_metadata`; `guardTimeViewer()` (`src/lib/admin-guard.ts:69`) trusts `user_metadata.role === 'hr'`. Supabase lets a user rewrite their own `user_metadata` with the anon key, so any employee self-assigns `hr`.
- **Impact:** reads all employees' aggregated time + onboarding data (`/api/admin/time-overview`, `/api/admin/time-user`, `/api/admin/onboarding`). Does **not** reach admin (admin is `ADMIN_EMAILS`).
- **Fix:** move the role to `app_metadata` (service-role-write-only) or a `user_roles` table with RLS. Update the write in `src/app/api/admin/users/route.ts` (PATCH) and all reads (`admin-guard.ts`, `user-role.ts` consumers, `cron/time-log-reminder`). One-time backfill migration to copy existing roles.
- **Effort:** M (touches role read/write in ~4 files + a data backfill).

**T0.2 — Gmail refresh token in client-readable `user_metadata`** _(MEDIUM)_
- **What:** `api/gmail/callback` stores `refresh_token` in `user_metadata` (line 25/31); `create-draft` reads it (line 108). `user_metadata` is in the user's JWT, readable by client JS.
- **Impact:** any XSS/malicious dependency exfiltrates a long-lived Gmail token (`gmail.compose` + `spreadsheets.readonly`) for persistent out-of-app access. Amplified by no CSP (T1.1).
- **Fix:** new server-only `gmail_tokens` table (service-role, RLS forced, grants revoked) keyed by `user_id`; write/read there. Rotate tokens already in metadata.
- **Effort:** M (migration + callback/create-draft/status/disconnect updates).

**T0.3 — Unauthenticated paid-LLM endpoint, bypassable rate limit** _(MEDIUM)_
- **What:** `POST /api/generate-brief` is unauthenticated and calls Claude Opus. Its rate-limit key comes from the left-most `X-Forwarded-For` (`src/lib/security/rate-limit.ts:31`), which is client-spoofable behind a proxy; the limiter is also in-memory (non-durable on serverless).
- **Impact:** anonymous denial-of-wallet on the Anthropic budget. `generate` / `render-brief` share the pattern (cheaper).
- **Fix:** require `getUser()` on the generation routes; derive IP from a trusted platform header (`x-real-ip` / `x-vercel-forwarded-for`); back the limiter durably (or use the Vercel firewall) for anything left public.
- **Effort:** S–M.

**T0.4 — HTML injection into Brief-mode emails via unescaped markdown URLs** _(MEDIUM, run-2 #5)_
- **What:** `markdownBlockToHtml` (`src/lib/mail-engine.ts:231-234`, `239-241`) interpolates link/image URLs into `href`/`src` without HTML-escaping (capture `[^)]+`, so a `"` breaks out), and runs over model-authored prose from the unauthenticated `/api/generate-brief` brief (`renderBriefMail`, `mail-engine.ts:717`).
- **Impact:** a crafted brief yields attacker-chosen links, remote images (tracking pixels), or broken-out HTML in the outgoing customer email — defeating the "links are never model-authored" tracking guarantee. Executable XSS is blunted by email-client sanitizers; no in-app `dangerouslySetInnerHTML` sink for `html_body`.
- **Fix:** HTML-escape + scheme-validate the URL (allow `https:`/`cid:` only), forbid quotes/whitespace in the capture, or strip markdown links/images from model prose (the plain-text path already does via `stripMarkdownLinks`).
- **Effort:** S.

**T0.5 — Team-chat message identity spoofing via unconstrained INSERT** _(MEDIUM, run-2 #6)_
- **What:** `chat_messages` grants `authenticated` a table-wide INSERT (`supabase/2026-04-19-team-chat.sql:39`) and the insert policy checks only `auth.uid() = sender_id` (`:48-51`). `sender_email` (free-text, drives the displayed identity) and the moderation fields `done_at`/`done_by`/`kind` are attacker-settable at insert.
- **Impact:** impersonation of any colleague/admin in the shared team channel (social-engineering/fraud vector) + forgeable moderation metadata. Bounded to the one channel; no data disclosure.
- **Fix:** BEFORE INSERT trigger stamping `sender_email` from `auth.jwt()->>'email'` and nulling `done_at`/`done_by`; or a column-scoped insert grant. New dated migration.
- **Effort:** S.

**T0.6 — SECURITY DEFINER RPCs never revoked from `PUBLIC`, and unauthorized by user** _(HIGH, run-3 F1/F2)_
- **What:** `tt_refresh_overtime_bank_stats(uuid, date)` is `security definer`, takes `p_user` and never compares it to `auth.uid()`, and its `grant execute ... to authenticated` was never paired with `revoke all on function ... from public`. Postgres default-grants `EXECUTE TO PUBLIC` on `CREATE FUNCTION` and `CREATE OR REPLACE` preserves the ACL, so `anon` held EXECUTE across all five definitions. `tt_resolve_audit_user_id(text, jsonb, jsonb)` has the same defect (no grant *or* revoke at all). Every other RPC in the schema *does* revoke — that asymmetry was the tell.
- **Impact:** anyone with the public anon key reads any employee's overtime balance (and writes their stats row); the second function maps sequential `day_log_id`s to employee uuids. Defeats the RLS boundary the time-tracker schema rests on. Target uuids come free from `chat_messages.sender_id` (`using (true)`, intentional).
- **Fix:** `supabase/2026-07-26-rpc-privilege-hardening.sql` — revoke from `public`, re-grant `authenticated` on the first only, add `if auth.uid() is not null and auth.uid() <> p_user then raise ... 42501`, and reorder `search_path` to `pg_catalog, public, pg_temp`. The null-uid clause is required: the statement triggers and all service-role paths call it with no JWT context.
- **Effort:** S. **Applied by hand?** ⚠️ yes, required.

**T0.7 — Unauthenticated open redirect at `/auth/callback?next=`** _(MEDIUM, run-3 F3)_
- **What:** `next` fed straight into `NextResponse.redirect(new URL(next, origin))`. Resolving against a base does not constrain the target — an absolute or protocol-relative value discards the base. Route is not in the proxy matcher and needs no `code`, so it is reachable unauthenticated.
- **Impact:** phishing links carrying our own trusted origin. No token leak (the OAuth code is consumed server-side, not forwarded).
- **Fix:** `src/lib/safe-redirect.ts` (`safeRedirectPath`) — rooted single-`/` paths only; rejects absolute, `//host`, backslash variants and control chars. Colocated test; verified live.
- **Effort:** XS.

**T0.8 — Client-writable derived overtime cache** _(MEDIUM, run-3 F4)_
- **What:** `time_tracker_user_stats` granted `authenticated` table-wide `insert, update` with own-row policies but no column restriction or value check. `overtime_bank_mins` is derived, and `tt_admin_overview` reports it verbatim to Admin → Team time.
- **Impact:** a user sets their own reported overtime balance to any value; it survives until they next edit a day.
- **Fix:** `supabase/2026-07-26-user-stats-integrity.sql` revokes `insert, update`, keeps `select`; the client-side upsert in `time-tracker-queries.ts` now computes for display only. Own-row policies deliberately left in place. 
- **Effort:** S. **Applied by hand?** ⚠️ yes, required.

**T0.9 — `markdownToHtml` emitted raw source HTML; `html_body` unsanitized** _(MEDIUM, run-3 F5/F6)_
- **What:** T0.4 fixed the URL interpolation but left the escaping pass, which split on `/(<[^>]+>)/` and passed through anything tag-shaped — it cannot distinguish tags it generated from tags in the source. Confirmed by execution: `<script>`, `<style>`, `<a>`, `<img onerror>` all survived. Separately `html_body` was the only create-draft field bypassing sanitization.
- **Impact:** **not XSS** — `html_body` has no in-app render sink and the author is authenticated. It is a broken escaping control and falsifies the "the model never emits or formats links" guarantee in `mail-brief-llm.ts`, since Brief-mode prose is LLM-written from briefs that carry pasted customer text.
- **Fix:** placeholder-token approach — markdown constructs are swapped for `U+E000<n>U+E000` before the prose is escaped wholesale, then restored, so generated markup never passes through the escaper. Plus `sanitizeMailHtml` on `html_body` as an explicit second layer (a denylist, documented as such).
- **Effort:** S.

**T0.10 — Admin RPCs executable with the anon key** _(CRITICAL, run-4 F1)_
- **What:** eight admin-only `SECURITY DEFINER` functions (`tt_admin_overview`, `tt_workspace_summary`, and the six `mail_*` tracking RPCs) paired their grant with `revoke all ... from public` only. On Supabase, default privileges grant EXECUTE on new `public` functions to `anon`, `authenticated` and `service_role` **by name**, and a revoke from PUBLIC does not touch named grants. Confirmed live 2026-09-29: `rpc/mail_recipient_search` answered 200 to an anon caller.
- **Impact:** anyone holding the public anon key (it is in every page's JS) reads every employee's weekly hours and overtime balance, and every external mail recipient's name, company, sends and click history. RLS does not help — definer functions bypass it.
- **Fix:** `supabase/2026-09-29-rpc-revoke-anon-execute.sql` revokes from `public, anon, authenticated` (admin RPCs) or `public, anon` (the two user RPCs), and changes the default privileges so future functions start with no EXECUTE for anyone. A closing `do` block raises if anon can still run any definer function, so a clean apply is itself the verification. `rls-smoke.mjs` check 7 probes all ten with the bare anon key and passes only on `42501`.
- **Lesson:** run-3's T0.6 fix revoked `tt_resolve_audit_user_id` from all three roles — the right pattern — but the same bug in the other RPCs was not looked for, and the live verification only checked the two functions it had touched. Grep for the pattern, not the instance.
- **Effort:** XS. **✅ APPLIED and VERIFIED 2026-09-29** in the SQL editor (the closing guard block passed). Re-probed live with the bare anon key afterwards: all ten functions answer `401 / 42501`.

**T0.11 — Domain restriction enforced only after the account exists** _(HIGH, run-4 F2)_
- **What:** the `@flyability.com` rule lived only in `app/auth/callback/route.ts`, which runs after Supabase has already created the account and issued a session. Sign-up is open (email + Google), so a session obtained without passing through that route — e.g. `POST /auth/v1/signup`, confirm, password sign-in — kept every `to authenticated` grant.
- **Impact:** an outsider reads all team chat and attachments, the fleet directory (staff emails), and uses the session-only API routes (paid LLM, mails to admins). Checked 2026-09-29: no outsider account existed — `auth.users` held only `flyability.com` accounts and the owner's own Gmail (created 2026-09-23 via Google, which itself shows the gap).
- **Fix:** `supabase/2026-10-02-restrict-signup-domain.sql` — a Supabase Auth *Before User Created* hook that refuses any non-`@flyability.com` email for every provider. The callback check stays as a second layer.
- **✅ APPLIED and VERIFIED 2026-09-29:** hook enabled in Authentication → Hooks; an anon-key sign-up for `audit-test@example.com` returned `403 "Sign-up is limited to @flyability.com accounts."` and created no user.
- **Still open (run-4 F3):** the hook stops outsiders, but a held or role-revoked *employee* still reaches every non-admin route and the `to authenticated` RLS policies. That needs a server-side role check.
- **Effort:** XS.

### Tier 1 — Hardening (defense-in-depth)

**T1.1 — Security headers.** `next.config.ts` sets none. Add a `headers()` block: `Content-Security-Policy` (the mitigating layer for T0.2), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`. Effort: S (CSP tuning is the only real work).

**T1.2 — Durable rate limiting. DONE — live in production 2026-07-31.** `lib/security/rate-limit.ts` uses an Upstash-compatible Redis REST store when configured and falls back to the in-memory `Map` otherwise (and on store error — a Redis blip weakens the limit, it does not remove it or fail the request). `checkRateLimit` is **async**; all 8 call sites await it.
- **Provisioned:** Upstash for Redis via the Vercel Marketplace, free tier, primary region **Frankfurt (fra1)**. Connected to the `mail-automator` project; the integration injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` (it does not emit the `UPSTASH_*` names — the code accepts either pair).
- **Verified end to end**, not assumed: two Time Tracker saves produced exactly **one** key, `rl:time-tracker-write:<uuid>:<ip>`, with `DBSIZE` = 1. One key from two requests is the fixed-window counter incrementing rather than creating per-request state; had the app been falling back to in-memory, the store would have been empty.
- **Note the keys contain personal data** (user id + IP) in a third-party store. Two things bound that: the region is in the EU, and every key carries the rate-limit window as its TTL, so nothing accumulates. Deliberate inconsistency worth knowing about: `app/r/[id]/route.ts:16` hashes click-tracking IPs with `TRACKING_SALT`, the limiter stores them raw. Kept raw on purpose — being able to read the offending IP off a key is the point during an abuse incident, and the TTL is short.
- Env vars remain scoped to All Environments. They are integration-managed (no per-variable Edit in Vercel); rescoping to Production+Preview is done via *Manage Connection*. Left as-is deliberately: local dev uses a hand-maintained `web/.env` and never runs `vercel env pull`, so the Development scope is inert.

**T1.3 — OAuth `state` (fixes finding #4).** Random `state` set as HttpOnly cookie at connect (`getAuthUrl` in `lib/gmail.ts`), verified in `api/gmail/callback`. Effort: S.

**T1.4 — Constant-time `CRON_SECRET` compare.** `authorize()` in `cron/time-log-reminder` uses `===`; use `crypto.timingSafeEqual`. Effort: XS.

**T1.5 — Middleware fail-closed.** `updateSession` catches all errors and returns `next()` (fail-open) for protected paths; prefer redirecting to `/login` on error for `/dashboard`+`/settings`. Effort: XS.

**T1.6 — `time_tracker_audit_log` missing `force row level security`** (`supabase/time-tracker-durability.sql:24`) — the only one of 16 tables without `force`. Add it for consistency. Effort: XS. _(run-2 H5)_

**T1.7 — Tighten `chat-attachments` Storage.** Read policy is bucket-wide for all authenticated (`team-chat.sql:76-80`) and the 10 MiB cap is client-only (`chat.ts:309-313`). Scope reads and add a bucket-level size limit. Low impact (message rows are already team-wide readable). Effort: S. _(run-2 H6)_

**T1.8 — Unauthenticated outbound fetch on `/api/generate`.** Anonymous callers drive DuckDuckGo fetches via `enrichWithAutoResearch` (`company-research.ts:57`); fixed host so not SSRF, but compute amplification. Folds into T0.3's "require auth on generation routes." _(run-2 H7)_

**T1.9 — Role read from `user_metadata` in the dashboard.** _(run-3 F7)_ `dashboard/page.tsx` was the last reader of the field T0.1 retired; it rendered the HR/admin tab for any self-assigned role (endpoints behind it still 403'd). Fixed to read `app_metadata`, matching `settings/page.tsx` and `admin-guard.ts`; stale docstring in `lib/user-role.ts` corrected. Effort: XS. **Done.**

**T1.10 — Cron route: mail-sending GET with no CSRF defence or rate limit.** _(run-3 F8)_ `SameSite=Lax` cookies ride cross-site top-level navigations, so one admin click fired `?send_test=<any address>` or a real `?force=1` blast. Added a per-IP limit (20/h) and a `Sec-Fetch-Site` check refusing *cross-site* invocation of any shape that can send — including the plain unforced call inside the real Monday 09:00 window. `preview`/`dry` stay open; admin-typed URLs (`Sec-Fetch-Site: none`) and Vercel Cron (no `Sec-Fetch-*` at all) are unaffected, so the runbook still works. Effort: S. **Done.**

**T1.11 — `chat-attachments` had no `allowed_mime_types`.** _(run-3 H4)_ Content-type is client-supplied (`chat.ts:328`). Bucket is private, signed-URL, and on a *different origin* from the app, so never app-session XSS — but it is script execution on the Supabase origin. `supabase/2026-07-26-chat-attachment-mime-allowlist.sql` sets a deliberately broad list excluding only browser-executable types (notably SVG). Effort: XS. **Applied by hand?** ⚠️ yes.

**T1.12 — `search_path` ordering on the remaining RPCs.** _(run-3 H5)_ **Done 2026-07-31** — `supabase/2026-07-31-search-path-pinning.sql` repins all 14 remaining functions to `pg_catalog, public, pg_temp` via `alter function` (setting only; no body is re-declared, so there is no transcription risk). Verified beforehand that neither `anon` nor `authenticated` holds `CREATE` on schema `public`, so this was hardening rather than a live hole. **Applied by hand?** ⚠️ yes.

### Tier 2 — Detection & response (the second requested capability — build now)

The app records **no** security events and has **no** breach alerting. Extend the existing patterns rather than adding new infra.

**T2.1 — Security-event log.**
- Migration `web/supabase/2026-07-02-security-events.sql`: `public.security_events` (`id, kind, severity, actor_email, ip, user_agent, detail jsonb, created_at`), RLS forced + grants revoked — mirror `2026-07-01-admin-audit-log.sql`.
- `src/lib/security/security-events.ts`: `recordSecurityEvent()` — best-effort, never throws (mirror `recordAdminAudit()`). `SecurityEventKind`: `failed_admin_access`, `rate_limit_tripped`, `oauth_failure`, `suspicious_login` (extension point).
- Emit sites: `guardAdmin()`/`guardTimeViewer()` record `failed_admin_access` when a **logged-in non-admin** is rejected (401s from logged-out users are noise — skip them).

**T2.2 — Breach notification (reuses Resend).**
- `src/lib/security/breach-alert.ts`: `maybeAlertAdmins(event)` — when severity is high, or _N_ `failed_admin_access` from one actor within a window, email each `ADMIN_EMAILS` address via `sendEmailViaResend()`. Debounce (a `last_alerted_at`/state row) so one incident ≠ an email storm.
- Admin toggle `security_alerts_enabled` on `workspace_settings`, following the `reminder_paused`/`mail_brief_model` pattern; the toggle change is written to `admin_audit_log`.

**T2.3 — Admin UI.** Read-only `src/components/admin-security-events.tsx` (When/Kind/Severity/Actor/IP/Detail), read API `src/app/api/admin/security-events/route.ts` (`guardAdmin`, service-role, newest-first, limit 100), mounted as a new section in `admin-panel.tsx` beside "Audit log". Toggle surfaced near `admin-reminder-controls.tsx`.

**T2.4 — Release note** in `src/lib/release-notes.ts` (user-facing admin feature).

> Note: T2 is **detection**, not prevention — it tells the admin when someone is probing (e.g. attempting T0.1 escalation shows up as repeated `failed_admin_access`). It complements, and does not replace, the Tier 0 fixes.

## Suggested sequence

1. **T0.1** (highest impact, exploitable today).
2. **T2 detection + alerting** (this PR) — so probing/escalation attempts are visible while the rest is fixed.
3. **T0.2, T0.3**, then **T1.1** (CSR­P) which backstops T0.2.
4. Remaining Tier 1.
5. Re-run the audit for the coverage gaps listed in `REPORT.md` (mail-tracking admin queries, team-chat storage, Google Sheets ingestion, RLS policy sweep, time-tracker write logic).

## Status log

- 2026-07-02 — Audit run-1 completed; masterplan created; **T2 (detection + breach alerting) implemented** in this branch. Tier 0/1 items open.
- 2026-07-02 — **Audit run-2 completed** (full recon fleet over the run-1 gap areas: mail-tracking, chat + Storage, Sheets, time-tracker, settings, RLS sweep). Added T0.4/T0.5 (both MEDIUM integrity) and T1.6–T1.8. Confirmed clean: mail-tracking routes (no injection/IDOR), RLS across all 16 tables, time-tracker writes, account/delete, settings, Sheets fixed-spreadsheet, company-research (not SSRF). Artifacts in `docs/security-audit/run-2/`.
- 2026-07-02 — **All five Tier 0 fixes applied** (code changes in this branch; lint + build + typecheck pass):
  - **T0.1** — role moved to `app_metadata` (service-role-write-only); guard + admin PATCH + insights/time-overview/onboarding/cron routes + settings page now read it there.
  - **T0.2** — Gmail refresh token moved to a service-role `gmail_tokens` table via new `lib/gmail-tokens.ts`; callback/create-draft/status/disconnect + the time-tracker Sheets read rewired.
  - **T0.3** — `getUser()` gate added to `generate`, `generate-brief`, `render-brief`; rate-limit IP now taken from trusted `x-real-ip`/`x-vercel-forwarded-for`.
  - **T0.4** — markdown link/image URLs HTML-escaped + scheme-allowlisted in `markdownBlockToHtml`.
  - **T0.5** — BEFORE INSERT trigger stamps `chat_messages.sender_email` from the JWT and nulls `done_at`/`done_by`.
  - **⚠️ Apply these three migrations by hand** (flat, un-orchestrated): `supabase/2026-07-03-role-in-app-metadata.sql`, `2026-07-03-gmail-tokens.sql`, `2026-07-03-chat-insert-hardening.sql`. Each backfills so connected users keep working; the code reads the new locations, so **the app must not be deployed ahead of applying the migrations** (roles/Gmail would read empty until backfilled). Deploy order: apply migrations → deploy code.
  - Remaining open: Tier 1 hardening (T1.1–T1.8).
- 2026-07-02 — **Tier 1 hardening applied** (lint + build + typecheck pass; security headers verified emitting via `next start` + curl):
  - **T1.1** — security headers in `next.config.ts` `headers()`: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a CSP. The CSP ships **Report-Only** (`Content-Security-Policy-Report-Only`) so it can't break prod; set env `CSP_ENFORCE=1` to enforce after verifying no violations in staging (watch the browser console). `connect-src` is derived from `NEXT_PUBLIC_SUPABASE_URL` (REST + `wss` realtime).
  - **T1.3** — Gmail OAuth `state`: random value set as an HttpOnly cookie at `connect`, matched (and cleared) in `callback`. Closes finding #4.
  - **T1.4** — `CRON_SECRET` now compared with a constant-time SHA-256 `timingSafeEqual`.
  - **T1.5** — `updateSession` middleware now **fails closed** on error for `/dashboard`+`/settings` (redirects to `/login`) instead of `next()`.
  - **T1.6 / T1.7** — `supabase/2026-07-04-tier1-hardening.sql`: `force row level security` on `time_tracker_audit_log`; server-side 10 MiB `file_size_limit` on the `chat-attachments` bucket. **Apply by hand.**
  - **T1.8** — folded into T0.3 (auth now required on `/api/generate`, so the DDG outbound-fetch is no longer anonymous).
  - **T1.2 — still open** (durable rate limiting): needs an external store (Upstash / Vercel KV) or the Vercel edge firewall — an infra decision, not shipped here. The IP-source fix (T0.3) already removed the spoofable-key bypass.
  - **RLS testing** added: `web/scripts/rls-smoke.mjs` (`npm run test:rls`) signs in two ordinary users via the anon key and asserts cross-user read isolation, that `app_metadata.role` is not user-settable (T0.1), that a spoofed chat `sender_email` is stamped from the JWT (T0.5), and that service-role-only tables are unreadable. Needs `RLS_TEST_A_/RLS_TEST_B_` creds in the env; run against staging.
- 2026-07-26 — **Audit run-3 completed** (3-agent recon fleet weighted to the areas runs 1–2 never examined: Postgres function privileges, the auth callback, the outbound-HTML builder after its T0.4 fix, cron CSRF, role-read consistency). Artifacts in `docs/security-audit/run-3/`; posture write-up at `docs/security-posture.md`.
  - Re-verified **all** run-1/run-2 fixes against source rather than trusting this log — T0.1–T0.5 and T1.1/T1.3–T1.7 all hold.
  - **8 new findings, all fixed in this branch:** T0.6 (HIGH, definer RPC privilege escalation), T0.7 (open redirect), T0.8 (forgeable overtime cache), T0.9 (HTML escaper + `html_body`), T1.9 (role read), T1.10 (cron CSRF/rate limit), T1.11 (attachment MIME), plus H-notes.
  - **✅ All three migrations APPLIED and VERIFIED 2026-07-26** (`supabase/2026-07-26-rpc-privilege-hardening.sql`, `2026-07-26-user-stats-integrity.sql`, `2026-07-26-chat-attachment-mime-allowlist.sql`). Verified in the SQL editor with rolled-back transactions using `set local role` + `set local request.jwt.claims`: a user JWT calling `tt_refresh_overtime_bank_stats` for **another** user raises `42501`; for **their own** id it still returns the balance; `anon` gets `permission denied` on both functions, as does `authenticated` on `tt_resolve_audit_user_id`; a client `update` of `time_tracker_user_stats.overtime_bank_mins` is denied while `select` still works; and `proacl` now shows no bare `=X/` (PUBLIC) entry on either function. Time Tracker and Admin → Team time both still render correctly.
  - **Two lessons worth keeping.** (1) `rls-smoke.mjs` was structurally blind to T0.6 — it asserted cross-user *table* isolation and never called an RPC, but a `SECURITY DEFINER` function bypasses RLS by design. RPC probes added, plus a check that the stats cache is read-only to clients. (2) T0.9 shows a prior fix can be incomplete: run-2's T0.4 hardened one hole in `markdownBlockToHtml` and left a second, broader one in the same function.
  - **Verification:** 69 tests / 11 files pass; lint and build clean; `npm audit --omit=dev --audit-level=high` reports 0 (the 2 highs `npm audit` shows are dev-only). T0.7 and T1.10 confirmed fixed against a running `next start`; T0.9 confirmed broken-before/fixed-after by executing the escaper in isolation.
  - **Verification gap now closed:** at audit time T0.6 rested on the live `proacl`, which was read from the migrations but never queried (the DB was unreachable from that session). It was confirmed against the live database on 2026-07-26 — see the line above. **T0.6 is closed.**
  - **CSP enforcement flag flipped 2026-07-26** — `CSP_ENFORCE=1` set in Vercel, so the policy now blocks instead of observing. T1.1 is complete. `script-src` still carries `'unsafe-inline'` for the theme bootstrap, so it is a strong framing/exfiltration control but not yet a strong XSS backstop; nonce that script to finish the job.
  - **Still open at the time of run-3:** T1.2, T1.12, the CSP nonce, HSTS preload submission, and the HR data-scope question. See the 2026-07-31 entry below — all but the two provisioning steps are now closed.

- 2026-07-31 — **Run-3 follow-ups shipped.** Everything left on the run-3 open list is now either done or reduced to a provisioning step.
  - **HR data scope — decision made: the wider scope is correct.** HR is *intended* to see day-level records including sick leave. Two changes follow from accepting that rather than narrowing it: `guardTimeViewer`'s docstring no longer claims "summaries only" (it now enumerates exactly what a time viewer can reach, for anyone adding a route behind it), and `/api/admin/time-user` writes an `employee_record_view` row to `admin_audit_log`. **Correction to the run-3 report:** it implied HR reads were already audited. They were not — `admin_audit_log` only ever covered writes (role changes, workspace settings). Reads of individual employee records were invisible until this change.
  - **T1.12 done** — `supabase/2026-07-31-search-path-pinning.sql`. ⚠️ apply by hand.
  - **T1.2 done and live** — durable rate-limit backend behind env config; `checkRateLimit` is now async. Upstash Redis (free tier, Frankfurt) provisioned and verified in production the same day; see T1.2 above.
  - **CSP nonce done (T1.1 complete).** The policy moved out of `next.config.ts` (static headers cannot carry a nonce) into `lib/security/csp.ts`, emitted per request by `src/proxy.ts`. `script-src` is now `'self' 'nonce-<per-request>'` with **no `'unsafe-inline'`**, so an injected inline `<script>` is refused. `style-src` deliberately keeps `'unsafe-inline'` — Tailwind and framer-motion mutate inline styles per frame. `'strict-dynamic'` was considered and deliberately deferred: it is a further tightening with real breakage risk and does not belong in the same change.
    - **Trade-off, stated plainly:** reading the nonce in the root layout makes every page dynamically rendered. `/dashboard`, `/login`, `/onboarding` and `/settings` were previously prerendered (`○`) and are now `ƒ`. For an internal tool with a handful of users this is negligible; it is recorded here so nobody later "fixes" the regression by removing the nonce.
    - The proxy matcher widened from three paths to everything-but-static-assets so the CSP reaches every HTML response. Session work did **not** widen — `needsSession()` still limits the Auth-server round-trip to `/dashboard`, `/settings`, `/login`.
    - Verified against a built server: the enforced header carries a fresh nonce per request, and **all 19 script tags on `/login` (7 of them inline, including Next's own bootstrap) carry it** — nothing is blocked. Static assets are correctly outside the matcher; the gating redirect still fires.
  - **T1.11 / RLS suite** — `npm run test:rls` no longer hardcodes `.env.local` (this checkout uses `.env`, so it could never have run as written). Added `npm run test:rls:setup`, which creates the two throwaway non-admin accounts the suite needs. It is **dry-run by default** and requires `--yes`, because it creates real users visible to admins — run it against staging if you have one.
  - **Nothing left open from run-3.** The KV store was provisioned and verified the same day (T1.2). HSTS preload needs no action: `vercel.app` is itself on the browser preload list with `includeSubDomains`, so `mail-automator.vercel.app` is already covered — submitting a subdomain of an already-preloaded domain is a no-op. That item only returns if the app moves to a custom domain, which is covered by `docs/domain-change-runbook.md`.
