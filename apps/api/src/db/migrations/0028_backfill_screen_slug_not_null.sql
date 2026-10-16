-- These DELETEs remove test sessions that have no screen_slug. This is intentional:
-- no deployed environment has real data yet, so there is nothing to preserve.
DELETE FROM skill_ratings WHERE session_id IN (SELECT id FROM evaluation_sessions WHERE screen_slug IS NULL);
DELETE FROM evaluation_sessions WHERE screen_slug IS NULL;
