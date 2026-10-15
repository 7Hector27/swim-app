# 023 — Leaderboard eligibility and scoring rules

**Status: draft — confirm with Jason**

## Context

The leaderboard feature exposes three public boards (Club, ISL, Master) and three
matching coach-only mirrors.  Several of the rules below are inferred from the
product brief and must be confirmed before these boards are treated as authoritative.

## Decisions

### Board eligibility

| Board | Who appears |
|---|---|
| Club | Swimmers with an active club-league registration in the current season (`league = 'club'`, `season_start_year = <current>`, `withdrawn_at IS NULL`) |
| ISL (Irvine Swim League) | Swimmers with an active summer-league registration in the current season (`league = 'summer_league'`, same season logic) |
| Master | All active swimmers (`archived_at IS NULL`) regardless of league registration |

**Public boards** additionally require `is_public = true`.  
**Coach boards** include all active swimmers with no visibility filter.

*Inferred for Master board — confirm with Jason: should master eligibility be
restricted to swimmers who hold at least one active league registration, or does
any active swimmer qualify?*

### Age-group computation

| Board | Reference date for age calculation |
|---|---|
| Club | Today (LA timezone) |
| Master | Today (LA timezone) |
| ISL | The swimmer's `registered_on` date for the current season |

ISL uses `registered_on` rather than today so that a swimmer who ages up mid-season
is scored in the age group they belonged to at registration.  A swimmer whose
`registered_on` value is missing for the current season is excluded from the board
rather than defaulted to today's age.

*Inferred — confirm with Jason.*

### Sex split

All three boards partition results by `sex` (`female` / `male`).  A swimmer appears
in exactly one sex column based on their stored `sex` field.

*Inferred — confirm with Jason.*

### Personal best

PBs are computed as `MIN(time_hundredths)` per swimmer × event × course, counting
only `swim_type = 'meet'` rows.  Practice swims are excluded.  When a swimmer swims
the same event multiple times at the same meet (heat + final), both swims count and
the faster one becomes the PB.

### Ranking

Club and ISL boards rank rows within each `(sex, age_group, event_distance,
event_stroke, course)` partition, sorted by `time_hundredths` ascending.  Ties on
time share a rank and the next rank is skipped (1, 1, 3 — not 1, 1, 2).

Master board ranks by highest standard first, then fastest time within a standard
level.  Ties (same standard + same time) share a rank.

## Consequences

- `registered_on` must be populated for every ISL registration row or the swimmer
  silently falls off the ISL board.  The insert path enforces `NOT NULL` on this
  column, so this should not occur in practice.
- The `motivational_standards` table is seeded empty.  Until standards are loaded,
  all three `/leaderboard/master` endpoints return `{ standardsAvailable: false, rows: [] }`.
