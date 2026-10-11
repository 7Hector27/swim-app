# 016 — Swimmer birth dates stored; public display requires explicit consent

**Date:** 2026-10-10
**Status:** Accepted

## Context

ADR 005 records that birth dates collected during *parent* signup are checked for the 18+ requirement and then discarded. That decision was motivated by minimising PII storage for account holders who are adults.

Swimmers are different. Competition swimming divides participants into age groups (e.g. 8-and-under, 9–10, 11–12, …). Correctly placing a swimmer in an age group requires knowing their birth date at the time of each event, not just a coarse age. Calculating and re-storing the derived age group would be fragile — the source of truth would be lost and the calculation would need to be re-run whenever groupings change. Storing the birth date is the only reliable option.

A separate question is public display. Parents may not want their child's times and progress visible to strangers on a public leaderboard, even if the child is actively being coached.

## Decision

**Birth dates are stored permanently on the `swimmers` table.**

The birth date is used to calculate age groups at query time. It is never shown on any public-facing page. It is never logged.

**`is_public` on the `swimmers` table has no server default.**

The UI must collect an explicit answer from the parent during registration. There is no implicit opt-in or opt-out. The column being `NOT NULL` with no default means the database will reject a row that omits it — the application cannot forget to ask.

**When `is_public = true`, consent is timestamped and attributed.**

The columns `public_consent_at` (timestamptz) and `public_consent_by` (FK → profiles.id, on delete restrict) record when consent was given and which profile gave it. Only a guardian of the swimmer may grant this consent: the route that sets `is_public = true` verifies the authenticated caller is in the `guardians` table for that swimmer, then writes their profile ID and the current timestamp. The client never supplies these fields. Coaches cannot set `is_public` to `true`. Any guardian or the coach may set `is_public` back to `false`; the consent fields are retained as an audit trail, not cleared. On delete restrict is safe because profiles are never hard-deleted: closing an account disables the profile (`disabled_at`) and scrubs its personal fields, but the row is retained. The full account deletion flow is out of scope for now.

**Swimmers are soft-deleted.**

`archived_at` on the `swimmers` table replaces hard deletion. This preserves historical records (times, assessments) and means no cascade deletes propagate through the system unexpectedly. A swimmer who leaves the program can be archived; their data remains for record-keeping.

## Consequences

- Age-group calculations are always accurate and derived from source data.
- Opt-in is a deliberate, recorded act — not a default that parents might miss.
- Consent can be audited: when it was given and by whom.
- Public pages filter on `is_public = true` and show only first name and last initial.
- Soft deletes require all queries to add `WHERE archived_at IS NULL` for active-swimmer views.
