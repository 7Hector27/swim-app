-- Snapshot-only migration: resyncs the drizzle-kit meta snapshot with
-- the actual schema state after the custom-SQL migrations 0082/0083/
-- 0084 ran. Those migrations were generated with `--custom` and
-- added tables + check constraints + enum values via hand-written
-- SQL; their meta snapshots did not pick up those changes. The next
-- plain `db:generate` would therefore propose recreating every one
-- of those tables.
--
-- No DB changes here. The SQL is a no-op; the snapshot sitting next
-- to this file is the correctly-populated baseline so future
-- `db:generate` runs produce real diffs, not spurious re-creations.
--
-- Safe to apply in production: the migrator only runs the SQL
-- (which is empty), and drizzle_migrations advances `idx` so this
-- step is never replayed.

SELECT 1;
