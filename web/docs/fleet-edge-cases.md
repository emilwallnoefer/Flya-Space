# Fleet edge cases — masterplan

Status: approved 2026-10-18, not yet implemented. Each phase below is one PR; tick the phase heading when its PR merges, and keep this file as the record of *why* each rule exists.

Decided with Emil 2026-10-18: collisions are resolved by the **next booker, never automatically**; interchangeable units are grouped by an **admin-set `kind_key`** on each asset. Implemented phase by phase, one PR each (see Phases).

## Context

Fleet (beta) today is a clean happy path: reserve → pick up → bring back, a waitlist per exact start date, a daily e-mail reminder to the holder (`due_soon` / `due_today` / `overdue`), and a derived reliability score that sets the booking horizon. Everything that goes wrong between two people is invisible to the second person. The explorers' findings (all verified against the code):

- An overdue booking **blocks only up to its `end_date`**. `checkReservation` and the exclusion constraint both treat the days after it as free, so the next person can book, and even `check_out`, a unit that is still physically out. `check_out` checks no dates and silently overwrites `current_holder_user_id`.
- **No extend action** exists. The workaround is a second `reserve` from the day after the due date, which either fails on overlap or lands on a waitlist nobody is told about.
- **Nobody but the holder is ever notified.** Not on a late return, not on waitlist promotion, not on cancel, not when the unit they booked has not come back. Push exists (`lib/push/send.ts`, `web/public/sw.js` deep links) but Fleet uses only e-mail.
- A `reserved` booking that is never picked up **counts as overdue** in the score and gets "overdue… check it in" mails although check-in is refused for `reserved`. No no-show expiry exists.
- **Nothing groups interchangeable units.** `category` is too coarse (every drone), `model` is free text. The reserve refusal and the mobile "contested" notice only offer the waitlist.
- Deep links stop at `?module=fleet`; `detail` is local state in `fleet-panel.tsx` and `mobile-fleet-screen.tsx`.
- Push sending loops (send, prune gone devices, stamp `last_used_at`) are copy-pasted three times; no "notify user X" helper exists. No table fits per-booking dedupe (`push_reminder_sends` is weekly, `fleet_reminder_sends` is the holder's e-mail reminders).

Current workflow, for reference (files under `web/src/`): rules `lib/fleet-rules.ts`; reads `lib/fleet-queries.ts` + `lib/fleet-board.ts`; writes `app/api/fleet/route.ts` → `handlers/*` (actions: reserve, cancel, check_out, check_in, move, confirm_location, set_status, claim_holder, set_reminders, assign, return_to_pool, asset CRUD, register_member); cron `app/api/cron/fleet-return-reminder/route.ts`; UI `components/fleet/*` (desktop) and `components/mobile/fleet/*` (phone), both over `components/fleet/use-fleet.ts`.

## Edge cases and how each is solved

Grouped by who is hurt. Each row names the mechanism from the phases below.

### A. Material did not come back in time

| # | Case | Today | Solution |
|---|---|---|---|
| A1 | Holder is late; next booker's start date arrives and the unit is still out | Next booker sees a free cell, can book and "pick up" a unit that is not on the shelf | **Overdue blocks until returned** (P1): a `picked_up` booking past its due date keeps blocking day by day; the grid paints those days as "overdue, not yet back"; `check_out` refuses while the asset is `out` with someone else |
| A2 | Next booker should know *before* the day | Nothing | **"Your unit has not come back"** notice (P3) to the next booker when the previous booking turns overdue *and* its start is within 2 days, repeated once more on the start day. Text names the holder and says "contact them to find a solution"; includes free sibling units (P4) with a one-tap **Move my booking** |
| A3 | Holder is late and knows it (mission ran over) | Nothing, reminder mail only | **Extend** action (P2). If the extra days are free, done. If they collide, becomes an **extension request** to the next booker (A4) |
| A4 | Extension collides with the next booking | n/a | Next booker gets a request notice with three replies: **Accept and move** to a free sibling (P4; moves their own booking atomically), **Accept and shorten/cancel** my booking, **Decline** (holder is told, and told to call). Request expires at the next booker's start date; nothing changes without a reply. Admins can resolve either way from the detail dialog |
| A5 | Material dropped off days ago but checked in today | `returned_on = today`, late penalty for days it was on the shelf | `check_in` accepts an optional `returned_on` ≤ today and ≥ `start_date`, admin-confirmable; the UI asks "When did it come back?" when the booking is overdue (P1) |
| A6 | Holder never collected (no-show) and the span passed | Scored as overdue forever, mailed "check it in", cannot check in | **No-show expiry** in the cron (P1): a `reserved` booking whose `end_date` < today is closed as `cancelled` with event `no_show`; scored as a mild penalty (new term, smaller than late) instead of the overdue slope; the waitlist for its start date is promoted |
| A7 | Overdue reminders never stop; imported (`sheet_import`) bookings claim a score impact they do not have | Mails forever, wrong wording | Cron stops after day 30 and escalates once to admins at day 7 (P3); `sheet_import` bookings get a neutral text without the score sentence (P1) |
| A8 | Unit is overdue and the holder has no account (`user_id` null) | Skipped silently | Admins get the escalation (A7) with the holder label; next booker still gets A2 with "ask an admin" instead of a name (P3) |

### B. I need the material longer than expected

| # | Case | Solution |
|---|---|---|
| B1 | Extra days are free | Extend in place: `end_date` moves, same row, event `extended`, horizon re-checked on the *new end date* for non-admins (P2) |
| B2 | Extra days collide with one or more bookings | A4 flow, one request per colliding booking; the extension applies only when every one has accepted (P2) |
| B3 | Extension would exceed 84 days | Refused with the existing `too_long` reason; message suggests a hand-over to an admin (P2) |
| B4 | Holder wants fewer days (early return planned) | Shorten in place, no request needed, waitlist promoted for freed days, next booker notified "unit back early" (P2, P3) |
| B5 | Extension requested while a waitlist exists for those days | Waitlisted people are not asked, but the request notice to the next booker mentions "N people are also waiting" (P2) |

### C. Waitlist and cancellations (second-order, found in exploration)

| # | Case | Solution |
|---|---|---|
| C1 | Promoted from the waitlist, nobody told | Notice "You now have X for date–date" (P3), with Decline (cancels, promotes next) |
| C2 | Waitlist only matches the exact start date | `promoteWaitlist` considers any waitlisted span that is now free on the asset, ordered by score (P1) |
| C3 | Waitlist entries never expire | Cron cancels waitlisted rows whose `end_date` < today (P1) |
| C4 | Someone cancels; the sibling the waiter moved to is now worse | Out of scope; waiters see the free unit in the grid |

### D. Suggesting another unit of the same kind

| # | Case | Solution |
|---|---|---|
| D1 | Reserve refused on overlap | Refusal payload carries `alternatives: [{asset_id, name, location}]`, free for the exact span, same `kind_key`, bookable; UI offers **Book SVA-330 instead** next to the waitlist button (P4) |
| D2 | A2 / A4 notices | Same list embedded; **Move my booking** calls the new `move_booking` action, atomic under the exclusion constraint (P4) |
| D3 | Sibling is free but at another location | Shown with the location, never hidden; the person decides (P4) |
| D4 | Asset has no `kind_key` yet | No alternatives, no error; Manage shows an "Unassigned kind" count so admins fill it (P4) |

### E. Concurrency and trust (must hold throughout)

- Two people extend/move at once: the DB exclusion constraint stays the authority; `23P01` maps to the existing friendly 409.
- A request reply by someone other than the next booker (or admin) is refused with 403, same ownership pattern as `check_in`.
- Notices are sent **only after** a claim row is inserted (unique per `reservation_id, recipient_id, kind, sent_for_date`), only `23505` counts as "already sent"; same as `push_reminder_sends`.
- Names in notices come from `displayNameFor()`, never `user_metadata`.
- Unclaimed bookings never trigger reminders (existing invariant) and never *receive* notices; admins are the recipient instead.
- Reliability stays derived; the new `no_show` term is computed in `computeReliability`, not stored.

## Phases (one PR each, in order)

### P1 — Make the data honest (no new UI beyond small labels)

- `lib/fleet-rules.ts`: `blocksOn(span, day, today)` = blocking and (`day ≤ end_date` or (`picked_up` and `end_date < day ≤ today`)); `checkReservation` uses it; `occupiedUntil` gets an overdue variant for the grid; `computeReliability` adds `no_show` (`cancelled` + `closed_reason = 'no_show'`, −3 each, capped); `promoteWaitlist` input ordering unchanged but the candidate set widens (C2).
- Migration `supabase/2026-10-19-fleet-edge-cases-1.sql`: `fleet_reservations.closed_reason text` (`'returned'|'cancelled'|'no_show'|'moved'|'shortened'` or null); `fleet_asset_events.kind` gains `no_show`, `extended`, `shortened`, `moved_booking`, `notice_sent`.
- `handlers/check-out.ts`: refuse when `fleet_assets.status = 'out'` and holder ≠ viewer (409 "still out with X").
- `handlers/check-in.ts`: optional `returned_on` (A5), validated in zod and against the span.
- Cron: no-show expiry (A6), waitlist expiry (C3), overdue mails stop after day 30, `sheet_import` wording (A7).
- Grid + mobile book flow paint "overdue, not back" days as blocked; `dueLabel` unchanged.
- Tests: `fleet-rules.test.ts` (blocking past due, no_show term, widened waitlist), `route.test.ts` (check-out refusal, backdated check-in bounds), cron tests for expiry.

### P2 — Extend and shorten

- New actions in `handlers/schemas.ts`: `extend {reservation_id, end_date}`, `shorten {reservation_id, end_date}`. Handler `handlers/extend.ts`: owner or admin; `picked_up` or `reserved`; `checkReservation` with `ignoreId` (already supported) and horizon on new end date; on free → update row + event; on overlap → create `fleet_booking_requests` rows (one per colliding booking, kind `extension`) and return `{ pending: true, asked: [...] }`.
- Migration: `fleet_booking_requests (id, kind 'extension', reservation_id, target_reservation_id, requested_end_date, requester_id, recipient_id null-able, status 'pending'|'accepted'|'declined'|'expired'|'cancelled', resolution 'move'|'shorten'|'cancel'|null, created_at, resolved_at, resolved_by)`; service-role only; unique open request per `(reservation_id, target_reservation_id)`.
- Reply action `respond_request {request_id, resolution, move_to_asset_id?}`: recipient or admin; applies the resolution and, when every request on the extension is accepted, applies the extension in one sequence guarded by the exclusion constraint (if `23P01`, requests stay pending and both sides are told).
- UI: "Extend / shorten" on `my-material.tsx`, `reservation-detail.tsx` and the mobile detail sheet; a **Requests** strip on the Mine tab (desktop + phone) listing incoming requests with the three replies and outgoing ones with status. Pure request state helpers in a new `lib/fleet-requests.ts` with tests.

### P3 — Notices (push, e-mail fallback, in-app)

- `lib/push/notify-users.ts`: `pushToUsers(admin, userIds, payload, {ttlSeconds})` — the shared loop (send, prune gone, stamp `last_used_at`). Refactor the three existing callers onto it in the same PR (behaviour-neutral, covered by their tests).
- `lib/fleet-notices.ts` (pure, tested): `renderFleetNotice(kind, ctx) → {title, body, url, tag}` + e-mail `{subject, text, html}` for kinds `unit_not_back`, `extension_request`, `extension_accepted`, `extension_declined`, `waitlist_promoted`, `unit_back_early`, `overdue_escalation` (admins). URL = `/dashboard?module=fleet&reservation=<id>` (desktop) — same path works on the phone shell.
- `lib/fleet-notify.ts` (server): `sendFleetNotice({kind, reservationId, recipientIds, ctx})` — claim row in new `fleet_notice_sends (reservation_id, recipient_id, kind, sent_for_date)` first, then push to subscribed devices; e-mail via `sendEmailViaResend` only when the recipient has **no** push device; always writes a `notice_sent` event so the detail dialog shows "X was told on …".
- Senders: cron (A2 day −2 and day 0, A7 escalation day 7, C1 on promotion from cron), `extend`/`respond_request` handlers (A4, B2), `check_in` early (B4), `cancel`/`promoteWaitlist` (C1).
- Deep link: `fleet-panel.tsx` and `mobile-fleet-screen.tsx` read `?reservation=` via `readViewParam` and open `detail`, then clear the param (same as `?chat=open`).
- Settings → Notifications gains a "Fleet" toggle (per-user opt-out, stored in `user_metadata.fleet_notices` since it is a preference, not a privilege); default on.

### P4 — Same-kind alternatives

- Migration: `fleet_assets.kind_key text`, `fleet_kinds (key pk, label)` admin-maintained; grants per the CLAUDE.md function/grant rules (plain tables, RLS select for authenticated with `has_app_role()`, writes via service role).
- `lib/fleet-rules.ts`: `freeSiblings({asset, span, assets, spansByAsset}) → asset[]` (pure, tested): same `kind_key`, `isBookable`, no blocking span on the exact dates.
- `reserve` overlap refusal returns `alternatives`; `reserve-message.ts` appends "SVA-330 is free for those days." UI: alternative buttons next to "Join waitlist" (desktop composer, mobile book flow).
- New action `move_booking {reservation_id, asset_id}`: owner or admin; same dates; `checkReservation` on the target; update `asset_id`, event `moved_booking`, `closed_reason` untouched (same booking, new unit); on `23P01` friendly 409 with refreshed alternatives.
- Notices from P3 embed `alternatives` and the Requests strip shows **Move to SVA-330**.
- Manage: kind picker on the asset dialog, kinds list, "N units without a kind" hint.

### P5 — Polish and release note

- `RELEASE_NOTES` entry (user-facing: extend, requests, notices, alternatives).
- `web/README.md` fleet section + `.claude/rules/fleet.md`: new invariants (overdue blocks until returned; requests resolved by the recipient only; notices claim-then-send; kind_key opt-in).
- Add new RPC/table checks to `rls-smoke.mjs` if any RPC is introduced (none planned; tables only).

## Verification (the loop for each phase)

- P1: `npm run test` green incl. new cases; manual: overdue unit shows blocked days in grid and phone; `check_out` on a unit still out returns 409.
- P2: route tests for extend (free, overlap→pending, too_long, horizon), respond (403 for stranger, each resolution, all-accepted applies); UI walk on desktop + iPhone Playwright project.
- P3: unit tests for renderers and the claim-then-send dedupe (second call → `already_sent`); send a real test notice to Emil's device via the cron `?send_test=` pattern; verify the deep link opens the booking on both shells.
- P4: `freeSiblings` tests (kind match, bookable, exact-span free, no kind → empty); reserve-overlap response carries alternatives; move_booking atomicity under a forced `23P01`.
- Every phase: `npm run lint`, skeleton untouched (no workspace-home change), `npm run test:e2e` smoke.

## Out of scope (named so nobody expects them)

- Auto-moving another person's booking (decided: never).
- Chat room messages for fleet events (room is global, no DMs).
- An inbox beyond the Fleet Requests strip.
- Fixing the `category` CHECK vs. seed mismatch — separate housekeeping PR, noted for the user.
