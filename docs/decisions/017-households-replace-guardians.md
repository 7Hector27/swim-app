# 017 — Replace guardians table with household model

**Date:** 2026-10-11  
**Status:** Accepted

## Context

The `guardians` table (`profile_id → swimmer_id`) linked parents to swimmers directly. It had no concept of a family group, shared management, or permission tiers. Any parent could be a guardian of any swimmer.

## Decision

Replace `guardians` with a three-table household model:

- `households` — a named family group
- `household_members` — links profiles to households with a role (`owner`, `manager`, `viewer`)
- `household_audit_log` — records actions within a household (UUIDs only, no personal data)

Every profile belongs to exactly one household (unique index on `household_members.profile_id`). Every swimmer belongs to exactly one household (`swimmers.household_id NOT NULL FK`).

Signup creates a household named `"[last word of fullName] household"` and adds the caller as `owner`.

Permission checks use `requireHouseholdMember` (attaches `householdId` and `householdRole` to req) and `requireHouseholdRole(min)`.

## Consequences

- Setting `is_public` to `true` is now restricted to the household owner only.
- Swimmer data belongs to the family, not the individual parent account.
- Household membership management (invites, roles, removal) is out of scope for this PR.
- The `guardians` table is dropped; the backfill migration handles existing local dev data.
