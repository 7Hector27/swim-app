DELETE FROM skill_ratings WHERE session_id IN (SELECT id FROM evaluation_sessions WHERE screen_slug IS NULL);
DELETE FROM evaluation_sessions WHERE screen_slug IS NULL;
