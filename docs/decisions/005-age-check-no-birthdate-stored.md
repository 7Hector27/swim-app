# 005 — Age check at signup, birth date never stored

**Date:** 2026-10-07  
**Status:** Accepted

## Context

The app is adult-only. We need to verify age at signup but have no ongoing need for the user's birth date. Storing it creates unnecessary PII exposure.

## Decision

- The server **calculates age at signup time** and rejects anyone under 18.
- Age is calculated in **America/Los_Angeles** time using string-based date arithmetic (slicing `YYYY-MM-DD`) to avoid timezone conversion bugs.
- Only `age_attested_at` (a timestamp) is stored — not the birth date itself.
- Any account without `age_attested_at` is blocked from accessing the app.

## Why

- Not storing the birth date eliminates it as a target in a data breach.
- String-based date comparison sidesteps the class of bugs where `new Date(birthDate)` parses in UTC, making a user born on Jan 1 appear one day younger than they are in Pacific time.
- `age_attested_at` gives an audit trail without retaining the underlying data.

## Alternatives considered

- **Store the birth date** — enables future features (birthday messaging, age-group calculations) but creates ongoing PII liability for data we don't need.
