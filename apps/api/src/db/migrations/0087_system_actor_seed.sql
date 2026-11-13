-- System actor profile row.
--
-- Automatic refunds (the cron's expired-pending sweep and the lazy-expiry
-- safety net inside GET /coach/lessons) need an actor to satisfy
-- household_audit_log.actor_id NOT NULL. Previously each refund was
-- attributed to the lesson's original requestedBy — the parent — which is
-- misleading: the parent did not trigger the refund, a background sweep
-- did. This seed creates a single well-known profile row the server can
-- use as the actor for those refunds so the audit trail is unambiguous.
--
-- The id is fixed (all-zero UUID) so application code can hard-code
-- SYSTEM_ACTOR_ID as a constant. Role is 'parent' because user_role has
-- only 'coach' and 'parent' values and adding a third value would ripple
-- through every consumer of the enum; the role is cosmetic here — the id
-- is what's load-bearing.
--
-- ON CONFLICT DO NOTHING so the migration is idempotent against any
-- environment where someone has already backfilled the row.

INSERT INTO "profiles" ("id", "role", "full_name")
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'parent',
  'System'
)
ON CONFLICT ("id") DO NOTHING;
