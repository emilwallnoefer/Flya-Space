---
paths:
  - "web/vercel.json"
---

# Function region — do not remove

`web/vercel.json` pins `"regions": ["dub1"]` (Dublin). This is not a preference,
and `vercel.json` is strict JSON with nowhere to say so, which is why it is
written down here.

The Supabase project lives in **eu-west-1 (Ireland)**. Vercel's default function
region is `iad1` (Washington DC), and the project ran there until 2026-09-14 —
so every database round trip crossed the Atlantic twice, because the compute sat
between the European user and the European database. It was measurable from
anywhere: `/api/fleet` returning a bare 401, doing nothing but one
`auth.getUser()`, took **575 ms**. After pinning the region to Dublin the same
request takes **~153 ms**, and every request in the app improved by roughly the
same factor.

Rules that follow from this:

- **Keep the function region in the same AWS region as Supabase.** If the
  database is ever moved, move this at the same time, and check the mapping —
  Supabase `eu-west-1` is Vercel `dub1`, `eu-central-1` is `fra1`.
- The Hobby plan allows exactly one region, which is all this needs.
- `regions` in `vercel.json` overrides the dashboard, so the dashboard's
  Functions → Region setting becomes read-only for this project. That is the
  point: the region is infrastructure and belongs in the repo, not in a UI
  someone has to remember.
- To check what is actually serving traffic, read the `x-vercel-id` response
  header: `fra1::dub1::...` is `edge::function::id`. The **second** code is the
  one that matters. The first is only the edge nearest the visitor, which is why
  this was easy to miss — the app looked EU-hosted right up until it needed data.
