-- Remove the 11 auto-seeded Jason seasons introduced in 0033_seed_availability_seasons.sql.
-- The default hours in `availability_config` now cover dates before any coach-created season.
-- Matched by start_date (same keys the seed used) so the delete is a no-op on fresh databases
-- where the coach hasn't created any seasons yet. Coach-created seasons are not affected.

DELETE FROM "availability_seasons"
WHERE "start_date" IN (
  '2026-06-01',
  '2026-08-15',
  '2026-09-15',
  '2026-10-15',
  '2026-11-01',
  '2026-12-01',
  '2027-02-15',
  '2027-03-01',
  '2027-03-14',
  '2027-04-15',
  '2027-05-15'
);
