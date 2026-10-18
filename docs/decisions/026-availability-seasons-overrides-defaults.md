# 026 — Availability uses default hours + seasons + one-off overrides

**Date**: 2026-10-17
**Status**: Decided

## Decision

Coach availability is modeled as three layers resolved in order of specificity:

1. **Default hours** on `availability_config` — a single row with `default_teaches_days`, `default_start_time`, `default_end_time`. The baseline when nothing more specific applies.
2. **Seasons** (`availability_seasons`) — a named period starting on a given date with its own teaches-days, weekday hours, and optional distinct weekend hours. The active season is the one with the latest `start_date` on or before today in Los Angeles. Seasons stay in effect until the next season begins; there is no explicit end date.
3. **One-off overrides** (`availability_overrides`) — a single `date` that is either closed (`day_off`) or has a custom time window. Overrides win over seasons and defaults.

The server resolves effective hours for a given LA calendar date with `effectiveHours(date, seasons, overrides, defaults)`: override first, then the active season, then defaults.

## What this replaces

The old `availability_config` row carried a fixed two-season model:

- `school_year_start_time` / `school_year_end_time`
- `summer_morning_start_time` / `summer_morning_end_time`
- `summer_evening_start_time` / `summer_evening_end_time`
- `lesson_days`
- `season_summer_end_dates` — a hard-coded list of transition dates

Switching to seasons required editing the config row or shipping new transition dates in code. One-off closures (holidays, trips) had no first-class representation.

## Why the new model wins

1. **Open-ended seasons** — the coach can add any number of named periods (Fall, Winter Break, Spring Camp) with their own hours. The season list is the schedule; no code change required.
2. **One-off changes are first-class** — a day off or a shifted window for a single date is an override row, not a special case layered on top of fixed seasons.
3. **Weekend hours are optional per season** — a season either uses a single daily window or a distinct weekend window. The old model forced a weekday/weekend split year-round.
4. **Defaults catch the gaps** — before the first season begins, or if the coach deletes every season, the schedule falls back to a sane baseline instead of going dark.

## Consequence

- The UI shows seasons as a vertical list with a "Now" badge on the active season, plus a one-off calendar for overrides.
- Impact warnings run on every mutation (season create/patch/delete, override create/delete) so the coach sees which booked lessons fall outside the new schedule before confirming.
- "Copy next year" clones each season into the next calendar year, skipping any that would collide with a season already starting on the same date next year.
