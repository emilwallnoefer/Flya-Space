-- Reset the "Fly where people can't" leaderboard for rules version 2.
--
-- The run now speeds up on a three-phase curve to a higher cap, and the cage
-- bounces off contact below 2 m/s instead of crashing. Scores flown under the
-- old rules are not comparable with new ones, so the board starts empty.
--
-- APPLY ONLY AFTER the release carrying ELIOS_RULES_VERSION = 2 is live.
-- From that release on, POST /api/elios-score refuses any submission that does
-- not say it was flown under version 2 — including every tab still running the
-- previous build. Run this earlier and one of those tabs can post an old-rules
-- score onto the fresh board in the gap.
--
-- Data only; the table, its policies and grants are unchanged.

delete from public.elios_scores;
