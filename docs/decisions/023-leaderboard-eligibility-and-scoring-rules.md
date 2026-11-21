# 023 — Leaderboard eligibility and scoring rules

**Status: Accepted (2026-11-20)**

## Context

The leaderboard feature exposes three public boards (Club, ISL, Master) and three
matching coach-only mirrors. The rules below were originally inferred from the
product brief; Jason confirmed them in the November 2026 leaderboard cleanup
pass and the master-board standards rule was relaxed at the same time.

## Decisions

### Board eligibility

| Board | Who appears |
|---|---|
| Club | Swimmers with an active club-league registration in the current season (`league = 'club'`, `season_start_year = <current>`, `withdrawn_at IS NULL`) |
| ISL (Irvine Swim League) | Swimmers with an active summer-league registration in the current season (`league = 'summer_league'`, same season logic) |
| Master | Any active swimmer (`archived_at IS NULL`) with at least one meet time, regardless of league registration or motivational standard. |

**Public boards** additionally require `is_public = true`.
**Coach boards** include all active swimmers with no visibility filter.

### Age-group computation

| Board | Reference date for age calculation |
|---|---|
| Club | Today (LA timezone) |
| Master | Today (LA timezone) |
| ISL | The swimmer's `registered_on` date for the current season |

ISL uses `registered_on` rather than today so that a swimmer who ages up mid-season
is scored in the age group they belonged to at registration. A swimmer whose
`registered_on` value is missing for the current season is excluded from the board
rather than defaulted to today's age.

### Sex split

All three boards partition results by `sex` (`female` / `male`). A swimmer appears
in exactly one sex column based on their stored `sex` field.

### Personal best

PBs are computed as `MIN(time_hundredths)` per swimmer × event × course, counting
only `swim_type = 'meet'` rows. Practice swims are excluded. When a swimmer swims
the same event multiple times at the same meet (heat + final), both swims count and
the faster one becomes the PB.

### Ranking

Club and ISL boards rank rows within each `(sex, age_group, event_distance,
event_stroke, course)` partition, sorted by `time_hundredths` ascending. Ties on
time share a rank and the next rank is skipped (1, 1, 3 — not 1, 1, 2).

Master board ranks within the same partition. If one or more rows in the partition
hold a motivational standard, order is highest standard first then fastest time;
rows without a matching standard appear below them in time order. If no row in
the partition holds a standard, rows rank by time alone. Ties share a rank.

### Minimum event-list size

A partition (`sex, age_group, event_distance, event_stroke, course`) is included
on a public board only when it has at least `MIN_SWIMMERS_PER_EVENT_LIST = 3`
swimmers. The threshold is enforced server-side on all three public endpoints
and the `/leaderboard/summary` endpoint so small groups never travel to the
browser. Coach endpoints ignore the threshold — coaches see every event list,
however small, because coach boards are not public-facing surfaces.

## Consequences

- `registered_on` must be populated for every ISL registration row or the swimmer
  silently falls off the ISL board. The insert path enforces `NOT NULL` on this
  column, so this should not occur in practice.
- The `motivational_standards` table can be empty. In that case `/leaderboard/master`
  still returns rows ordered by time, with `standard: null` on every row. The
  web UI omits the Standard column when no row carries a standard.
- `/leaderboard/summary` reports which boards currently have at least one
  qualifying event list. The homepage leaderboard section, the landing page,
  and the nav links all hide themselves when nothing qualifies — so the public
  never sees a fake preview or an empty table.
