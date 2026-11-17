-- Enable RLS on household_invites. Every other public-schema table had its
-- RLS enabled either in the initial baseline (0000) or in the migration that
-- created it; household_invites slipped through at 0008_add_household_invites.
--
-- No policies are created. With RLS enabled and no policy, the table is
-- deny-all for non-service-role connections (anon + authenticated), matching
-- the posture of every other table. All reads and writes continue to go
-- through apps/api, which uses the service_role connection string.
--
-- Table grants are the Supabase defaults (anon / authenticated / service_role
-- each hold the full action set). No GRANT / REVOKE is needed; RLS is the
-- gate.

ALTER TABLE "household_invites" ENABLE ROW LEVEL SECURITY;
