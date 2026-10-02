-- Reset the "Fly where people can't" leaderboard for rules version 3.
--
-- The game was reworked: the space now decides whether the drone flies Assist
-- or ATTI, events (drafts, signal loss with Return-to-Signal, dust, darkness,
-- swinging cables, radiation, gas) happen mid-run, the pace rises with every
-- obstacle cleared, and contact with anything but a rope ends the run. Scores
-- flown under version 2 are not comparable, so the board starts empty.
--
-- APPLY ONLY AFTER the release carrying ELIOS_RULES_VERSION = 3 is live.
-- From that release on, POST /api/elios-score refuses any submission that does
-- not say it was flown under version 3 — including every tab still running the
-- previous build. Run this earlier and one of those tabs can post an old-rules
-- score onto the fresh board in the gap.
--
-- Data only; the table, its policies and grants are unchanged.

delete from public.elios_scores;
