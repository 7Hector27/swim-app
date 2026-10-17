-- Seed Jason's 11 seasons for the Jun 1, 2026 – May 15, 2027 cycle.
-- Source: docs/reference/jason-seasonal-schedule.md. Mid-Mar is DST-pinned
-- (starts_at_dst = true) so "Copy to next year" can rewrite its start_date to
-- the next year's daylight saving start.
-- Idempotent on start_date so re-running the migration is a no-op.

INSERT INTO "availability_seasons"
  ("name", "start_date", "teaches_days", "weekday_start_time", "weekend_start_time", "end_time", "starts_at_dst")
VALUES
  ('Jun – Jul',     '2026-06-01', '{1,2,3,4,5,6,7}', '17:00', '17:00', '21:00', false),
  ('Mid-Aug',       '2026-08-15', '{1,2,3,4,5,6,7}', '16:45', '16:45', '20:30', false),
  ('Mid-Sep',       '2026-09-15', '{1,2,3,4,5,6,7}', '16:00', '16:00', '19:30', false),
  ('Mid-Oct',       '2026-10-15', '{1,2,3,4,5,6,7}', '15:00', '15:00', '18:30', false),
  ('Nov',           '2026-11-01', '{1,2,3,4,5,6,7}', '14:30', '13:00', '17:30', false),
  ('Dec – mid-Jan', '2026-12-01', '{1,2,3,4,5,6,7}', '14:30', '10:00', '17:00', false),
  ('Mid-Feb',       '2027-02-15', '{1,2,3,4,5,6,7}', '14:30', '14:00', '18:00', false),
  ('Early Mar',     '2027-03-01', '{1,2,3,4,5,6,7}', '15:00', '15:00', '18:30', false),
  ('Mid-Mar',       '2027-03-14', '{1,2,3,4,5,6,7}', '16:00', '16:00', '19:30', true),
  ('Mid-Apr',       '2027-04-15', '{1,2,3,4,5,6,7}', '16:30', '16:30', '20:00', false),
  ('Mid-May',       '2027-05-15', '{1,2,3,4,5,6,7}', '16:45', '16:45', '20:30', false)
ON CONFLICT ("start_date") DO NOTHING;
