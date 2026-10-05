---
paths:
  - "web/src/components/fleet/**"
  - "web/src/lib/fleet-*"
  - "web/src/app/api/fleet/**"
  - "web/src/app/api/cron/fleet-return-reminder/**"
  - "web/src/app/api/admin/fleet-holder-claims/**"
  - "web/src/components/admin-holder-claims*"
  - "web/supabase/*fleet*"
---

# Fleet (beta)

Paths below are relative to `web/src/` unless they start with `public/`, `scripts/` or `supabase/` (all under `web/`).

- **Fleet (beta)** — material tracking + day-level booking (inclusive `start_date`/`end_date`; `end_date` is the due date), in `components/fleet/` (`fleet-panel.tsx` + `day-grid.tsx` + `manage-material.tsx` + `asset-icon.tsx` + `reliability-badge.tsx`), mounted lazily from `dashboard-shell.tsx` and reachable from the burger menu. Pure rules in `lib/fleet-rules.ts` (day math, conflict checks, reliability score, reminder schedule — all `Date.now()`-free and covered by `fleet-rules.test.ts`); server reads in `lib/fleet-queries.ts`; all writes through `app/api/fleet/route.ts` on the service-role client, since the booking horizon and queue order cannot be expressed as RLS. Reminders: `app/api/cron/fleet-return-reminder/`. Migrations: `supabase/2026-09-01-fleet-management.sql` (needs `btree_gist`), then `2026-09-01-fleet-holder-claims.sql` (lets a booking be filed under a NAME with a null `user_id`, adds the claim flow + `fleet_settings`), then `2026-09-01-fleet-assigned-pool.sql` (`fleet_assets.pooled` splits the bookable pool from fixed assignments; only pooled units render in the calendar), then `2026-09-15-fleet-claim-oversight.sql` (`self_match` + `claimed_label` on `fleet_holder_aliases`, and withdraws the unused `authenticated` select grant). Claiming a holder label is **deliberately permissive** — the sheet spelled people inconsistently, so a strict name match would strand the people the flow exists to onboard; a mismatch is recorded, mailed to `ADMIN_EMAILS`, and fixable from Admin → Holder claims (`app/api/admin/fleet-holder-claims/`). All of them are **structure only** — the material list is entered through the app (Fleet → Manage, admin only), never seeded. The reliability score is **derived, never stored** — keep it that way, or it will drift from the history it summarises. Two invariants that protect trust in it: rows with `source = 'sheet_import'` never affect anyone's score, and an unclaimed booking (`user_id` null) can never trigger a reminder.
