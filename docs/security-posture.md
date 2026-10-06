# How the Flya Space app and its data are secured

**Date:** 2026-07-26 · **Audience:** engineering · **Status:** post audit run-3, fixes on `worktree-security-audit-run3`

This is the mail-form write-up of where the app's security stands: what data it holds, how each
layer protects it, what the third security audit found, what I fixed, and what is still open and
needs a decision from someone other than me. Full artifacts are in
`web/docs/security-audit/run-3/`.

---

## 1. What we actually hold

Worth being concrete, because the protections only make sense against the data:

| Data | Where | Sensitivity |
|---|---|---|
| Time logs — start/stop, breaks, **sick leave**, holidays, free-text comp notes | `time_day_logs`, `time_day_breaks`, `time_comp_adjustments` | Personal / HR |
| Derived overtime balance | `time_tracker_user_stats` | HR |
| Employee directory + role assignments | Supabase `auth.users` (`app_metadata.role`) | Internal |
| Team chat messages and attachments | `chat_messages`, `chat_message_votes`, `chat-attachments` bucket | Internal, team-wide by design |
| Mail tracking — recipients, subjects, link clicks | `mail_sends`, `mail_send_links`, `mail_link_clicks` | Customer PII |
| **Gmail OAuth refresh tokens** | `gmail_tokens` | Secret — grants mailbox access |
| Workspace settings, admin audit log, security events | `workspace_settings`, `admin_audit_log`, `security_events` | Internal |

The two things that would hurt most if they leaked are the Gmail refresh tokens and the
time/sick-leave data. Both get the strongest treatment below.

---

## 2. The layers, and what each one is actually good for

**Identity.** Supabase Auth via Google OAuth. The callback enforces `@flyability.com` and signs
out anyone else. Sessions are Secure + SameSite=Lax cookies managed by `@supabase/ssr`. They are **not** HttpOnly — the browser Supabase client reads them to talk to Supabase directly — so the nonce-based CSP is what keeps a script injection from reaching the session.

**Two independent gates, deliberately.** `src/proxy.ts` refreshes the session and gates
`/dashboard`, `/settings`, `/login` — and it fails *closed*, redirecting to `/login` if the auth
server errors. But it is explicitly **not** the security boundary: every gated page re-checks
server-side, and **no API route relies on the proxy at all**. All 31 routes carry their own check.
That is why a middleware bypass (the CVE-2025-29927 class) would not expose anything here.

**Authorization.** Two guards in `src/lib/admin-guard.ts`:
- `guardAdmin()` — admin is an **env allowlist** (`ADMIN_EMAILS`), not a database row, so it
  cannot be reached by manipulating any data the user can touch. Empty var ⇒ everyone rejected.
- `guardTimeViewer()` — admin *or* `role === 'hr'`, read from **`app_metadata`**, which only the
  service role can write. (`user_metadata` is user-writable and must never carry a role — that
  was run-1's HIGH finding, fixed in July.)

Both use `getUser()`, a verified round-trip to the auth server, not a decoded cookie. Both fail
closed on every branch. **The invariant:** nothing touches the service-role client (which
bypasses RLS) before one of these returns ok. I traced every call site this run; it holds.

**Row Level Security.** All 17 tables have RLS `enable`d **and** `force`d. Per-user tables scope
every policy on `auth.uid()`. Tables holding secrets or audit data — `gmail_tokens`,
`workspace_settings`, `security_events`, `admin_audit_log`, all three `mail_*` tables — are
deny-all with grants revoked from both `anon` and `authenticated`; the service role is the only
way in. The two team-wide tables (chat) are intentionally global-read.

**Secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_*` are all
read only from modules marked `"server-only"`, which makes it a build error to import them into a
client component. Gmail refresh tokens live in a service-role-only table, never in the JWT. I
grepped every tracked file **and the entire git history** for committed credentials — nothing.

**Input handling.** Every route validates with zod and passes text through shared sanitizers.
Email addresses are regex-validated per entry, which is what makes MIME header injection
unreachable on the draft endpoint.

**Transport and browser.** HSTS (now with `preload`), `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, and a CSP with `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. No CORS headers anywhere — nothing
is opened cross-origin.

**Detection.** Blocked admin attempts by logged-in non-admins are written to `security_events`
and feed a breach-alert email to admins over a threshold. So probing is visible, not silent.

---

## 3. What run-3 found

Runs 1 and 2 (July 2nd) found 6 issues; **all are genuinely fixed** — I re-verified each against
source rather than trusting the changelog. This run went after ground they never covered, and the
most productive area was **Postgres function privileges**.

### The one that matters — HIGH

**Any holder of the public anon key could read any employee's overtime balance.**

`tt_refresh_overtime_bank_stats` is a `SECURITY DEFINER` function, so it reads the time tables
with RLS bypassed. It takes a user id as an argument and **never compares it to `auth.uid()`**.
And unlike every other RPC in our schema, its grant was never paired with
`revoke ... from public` — Postgres grants `EXECUTE TO PUBLIC` by default on `CREATE FUNCTION`,
and `CREATE OR REPLACE` preserves that ACL, so it stayed open across all five times we
redefined the function.

One call returns a colleague's overtime balance:
```js
supabase.rpc('tt_refresh_overtime_bank_stats', { p_user: '<colleague uuid>' })
```
Colleague UUIDs are free — `chat_messages.sender_id` is readable by every authenticated user, as
the shared channel intends. A second definer function, `tt_resolve_audit_user_id`, had the same
root cause and maps day-log ids to their owners.

**Two things worth taking from this beyond the fix:**

1. **Our RLS smoke test was structurally blind to it.** `scripts/rls-smoke.mjs` tested cross-user
   *table* isolation carefully — and never called an RPC. A definer function bypasses RLS by
   design, so no amount of table-level testing can see this class. I've added RPC probes.
2. **The tell was an inconsistency, not a smell.** Every other RPC revokes; these two didn't.
   Worth grepping for that pattern whenever we add a function.

### The rest

| Sev | Finding | Note |
|---|---|---|
| MED | `tt_resolve_audit_user_id` callable by `anon` | Same root cause as above |
| MED | **Open redirect** at `/auth/callback?next=` | `?next=https://evil.example` 307'd off-site from *our* domain. Unauthenticated, no middleware coverage. Phishing-grade — no token leak |
| MED | Users could **forge their own overtime balance** | `time_tracker_user_stats` was client-writable; Admin → Team time reports it verbatim. Integrity, in the employee's own favour |
| MED | `markdownToHtml` **passed raw HTML tags through** | The escaper split on `/(<[^>]+>)/` and passed through anything tag-shaped — it can't tell tags it generated from tags in the source |
| LOW | `html_body` was the only draft field left unsanitized | Compounds the above |
| LOW | Dashboard still read the role from `user_metadata` | Rendered the HR tab for anyone; every endpoint behind it still 403'd |
| LOW | Cron route: mail-sending **GET**, no CSRF defence, no rate limit | `SameSite=Lax` cookies ride cross-site navigations, so one admin click on a link fired `?send_test=` or a real blast |

**On the HTML one, being precise about impact rather than alarming:** this was **not XSS**.
`html_body` is never rendered in our DOM — the only `dangerouslySetInnerHTML` in the tree is a
static theme bootstrap. The author is always an authenticated employee. What it actually was is a
broken escaping control, and a falsification of the guarantee we document in
`mail-brief-llm.ts` — "the model never emits or formats links, so tracking can never break".
Brief-mode prose is LLM-written from a free-text brief that routinely contains pasted customer
text, so injected markup reached the customer email as live HTML. Also notable: this is the
*second* hole in that one function; run-2's fix hardened the URL interpolation and stopped there.

---

## 4. What I changed

**Code** (all tested, linted, builds clean):
- `lib/safe-redirect.ts` — new; rejects absolute URLs, `//host`, backslash tricks, control chars.
  Wired into the auth callback, with a colocated unit test.
- `lib/mail-engine/html.ts` — inverted the escaping order. Markdown constructs become opaque
  placeholder tokens *before* the prose is escaped wholesale, then get restored. Generated markup
  never passes through the escaper, so the escaper never has to guess what it produced.
- `lib/security/input-sanitize.ts` — new `sanitizeMailHtml`, applied to `html_body`. Explicitly a
  denylist and explicitly a *second* layer; the primary control is the renderer fix above.
- `dashboard/page.tsx` — role now read from `app_metadata`. No reader from `user_metadata`
  remains anywhere.
- `cron/time-log-reminder` — per-IP rate limit + a `Sec-Fetch-Site` check that refuses
  *cross-site* invocation of anything that can send mail. Admin-typed URLs and Vercel Cron are
  unaffected, so the runbook still works.
- `scripts/rls-smoke.mjs` — RPC probes, plus a check that the stats cache is read-only to clients.
- `next.config.ts` — `preload` on HSTS.

**Three migrations — ✅ applied and verified against the live database on 2026-07-26.** `web/supabase/` is a
flat, un-orchestrated directory, same rule as the July 3rd batch:

1. `2026-07-26-rpc-privilege-hardening.sql` — revokes PUBLIC from both definer functions, adds
   the `auth.uid()` caller check, pins `search_path` with `pg_catalog` first.
2. `2026-07-26-user-stats-integrity.sql` — revokes `insert, update` on `time_tracker_user_stats`
   from `authenticated`, keeps `select`.
3. `2026-07-26-chat-attachment-mime-allowlist.sql` — MIME allowlist on the attachments bucket.

**Verification:** 69 tests pass across 11 files; lint and build clean; `npm audit --omit=dev
--audit-level=high` (the exact CI gate) reports 0. The open redirect and the cron CSRF guard were
confirmed fixed against a running server, and the HTML escaper was confirmed both broken before
and fixed after by executing it in isolation.

**The one caveat from audit time is now resolved.** The two RPC findings rested on the live
`EXECUTE` ACL, which I could read from the migrations but not query. It was confirmed against the
live database on 2026-07-26: a user JWT calling the function for another user now raises `42501`,
`anon` is denied outright on both functions, the forged-overtime `update` is denied while `select`
still works, and `proacl` carries no PUBLIC entry. The positive controls all pass too — own-id
refresh still returns a balance, and both the Time Tracker and Admin → Team time render normally.
**The HIGH is closed.**

---

## 5. Follow-ups — all shipped 2026-07-31

Everything on the previous "still open" list has been closed or reduced to a provisioning step.

1. ~~CSP is Report-Only~~ **Enforced 2026-07-26**, and as of 2026-07-31 it also carries a
   **per-request nonce**, so `script-src` no longer needs `'unsafe-inline'`. An injected inline
   `<script>` is now refused outright, which it was not before. The policy moved out of
   `next.config.ts` (static headers can't carry a nonce) into `lib/security/csp.ts`, emitted by
   `src/proxy.ts`.
   **Trade-off worth knowing:** reading the nonce in the root layout makes every page
   dynamically rendered — `/dashboard`, `/login`, `/onboarding`, `/settings` were prerendered
   before and now render per request. Negligible at our scale, but it is a real change and it is
   why nobody should "optimise" the nonce back out.
   `style-src` still allows inline styles; Tailwind and framer-motion mutate them per frame, and
   inline style is a far weaker primitive than inline script.
2. **Durable rate limiting — done and live.** The limiter uses an Upstash Redis store (free
   tier, Frankfurt) and falls back to the in-memory counter if the store is absent or errors — a
   Redis blip weakens the limit rather than removing it or failing requests. Verified in
   production rather than assumed: two Time Tracker saves produced exactly *one* counter key,
   which is the shared fixed-window counter working; an in-memory fallback would have left the
   store empty. The rate limits are now real rather than per-instance.
3. **HR data scope — decided: the wider scope is correct.** HR is meant to see day-level records
   including sick leave. Accepting that came with two changes: the guard's docstring no longer
   claims "summaries only" (it now spells out exactly what a time viewer can reach), and viewing
   an individual's record writes an `employee_record_view` row to the admin audit log.
   **Correction to what I said earlier:** I stated HR views were already audit-logged. They were
   not — the audit log only covered *writes*. Reads of individual records were invisible until
   this change.
4. **`search_path` on the remaining functions — done.** `2026-07-31-search-path-pinning.sql`
   repins all 14 via `alter function`, which changes the setting without re-declaring any
   function body. Hardening rather than a live fix: we confirmed neither client role can create
   objects in `public`.
5. **RLS suite — now actually runnable.** `npm run test:rls` had hardcoded `.env.local` while
   this checkout uses `.env`, so it could never have run as written. Fixed, plus
   `npm run test:rls:setup` to create the two throwaway accounts it needs (dry-run by default —
   it requires `--yes`, because it creates real users that admins will see).
6. **HSTS preload — no action needed.** `vercel.app` is itself on the browser preload list with
   `includeSubDomains`, so `mail-automator.vercel.app` is already covered. Submitting a
   subdomain of an already-preloaded domain is a no-op. This only becomes a real task if the
   app moves to a custom domain — see `docs/domain-change-runbook.md`.

**One migration to apply by hand:** `web/supabase/2026-07-31-search-path-pinning.sql`. *(Applied 2026-07-31.)*

All run-3 follow-ups are now closed.

## 6. Where I'd push back on being reassured

Three runs have now found something every time, which is the honest read on any codebase this
size — not a sign of decline. What's changed is *where*: run-1 found architectural mistakes
(secrets in the wrong store), run-2 found integrity gaps, run-3 had to go to Postgres grant
semantics to find its HIGH. That trend is the right direction.

The genuinely strong parts, which I verified rather than assumed: the guard invariant holds
across all 31 routes with no IDOR on the service-role client; RLS is correct across all 17
tables; there are no committed secrets anywhere in history; there's no SQL or PostgREST filter
injection surface at all; OAuth `state` is properly implemented; and there are zero
security-related TODOs, debug endpoints, or dev bypasses.

The weak spot was never the code — it was that **three of our defensive layers were quietly not
running**. The CSP was Report-Only in production, so it blocked nothing. The RLS test suite
couldn't see the class of bug that produced this run's HIGH, because it only ever tested tables
and never called a function. And `npm run test:rls` pointed at a dotenv file this checkout does
not have, so it could not have run at all.

That is the pattern worth carrying forward: **a control you believe is on is worse than one you
know is off**, because it buys silence instead of attention. All three are fixed, and the fixes
are the kind that stay fixed — the CSP flag is asserted by a unit test, the RLS suite now probes
functions as well as tables, and the runner resolves whichever dotenv actually exists.
