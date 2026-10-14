# 021 — Lesson approval rules

**Date:** 2026-10-13
**Status:** Accepted

## Context

When a household submits a lesson booking request, the system must decide whether to auto-approve it or hold it as `pending` for coach review. The rule needs to be simple enough for parents to reason about while preventing abuse (e.g., households booking slots without prior vetting).

## Decision

A booking is **auto-approved** (status = `approved`, `approved_by = null`) if and only if the household already has at least one prior lesson in status `approved` or `completed` at the **same location**. In all other cases the booking is held as `pending`.

Concretely, `needsApproval(householdId, locationId, tx)` returns `true` (approval required) when the household has zero rows in `lessons` with:

- `household_id = <householdId>`
- `location_id = <locationId>`
- `status IN ('approved', 'completed')`

`declined`, `canceled`, `expired`, `no_show`, and `pending` lessons do not satisfy the threshold.

A `completed` lesson counts because Jason has already taught that household at that pool — they are trusted. Requiring only `approved` (excluding `completed`) would mean a household's second booking at a pool reverts to `pending` after their first lesson finishes, which is wrong.

## Consequences

- First booking at any pool → `pending`, `expires_at = starts_at − 16 h`.
- Subsequent bookings at the **same** pool → `approved`, `expires_at = null`.
- Booking a different pool resets to `pending` for that location (per-location gate, not global).
- `approved_by` is `null` for system auto-approvals; non-null for coach approvals.
