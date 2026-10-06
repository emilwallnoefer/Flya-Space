# Time Tracker Historical Import

This imports legacy Hour Logger JSON into per-user Supabase tables for the Flya Space project.

## 1) Create tables in Supabase

In Supabase SQL Editor, run:

- `web/supabase/time-tracker-schema.sql`
- `web/supabase/time-tracker-durability.sql`

This creates:

- `public.time_day_logs`
- `public.time_day_breaks`
- `public.time_comp_adjustments`
- `public.time_tracker_audit_log` (immutable row-level change history)
- `public.time_tracker_snapshots` (full per-user snapshots before writes)

All tables are protected with RLS for per-user access. The durability layer adds a safety snapshot before every API write so failed updates do not silently destroy state.

## 2) Add service role key locally

Set these env vars in your shell before running import:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Example:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

## 3) Run one-time import

From `web/`:

```bash
npm run import:hourlogger -- --file "/Users/emil/Downloads/hourlogger-data.json" --email "emil.wallnoefer@gmail.com"
```

The script:

- looks up user id by email in Supabase Auth
- upserts day logs by `(user_id, work_date)`
- replaces breaks for those day logs
- upserts compensation adjustments by `(user_id, work_date)`

## 4) Verify import

Check these tables in Supabase:

- `time_day_logs` rows for `emil.wallnoefer@gmail.com` user id
- `time_day_breaks` rows linked by `day_log_id`
- `time_comp_adjustments` rows for same user id

The command prints a JSON summary with imported row counts.
