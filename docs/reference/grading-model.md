# Grading model

A single reference for how ratings, rollups, start grades, golf scores, and the dependency map work in this app. Written to support charts, stats, and a redesign of the coach progress page.

Companion to [`skill-rubric.md`](./skill-rubric.md) (the coach-facing rubric content) and [`decisions/025-golf-score-age-groups.md`](../decisions/025-golf-score-age-groups.md).

- [Part 1 — How grading works](#part-1--how-grading-works)
- [Part 2 — What we could chart](#part-2--what-we-could-chart)
- [Part 3 — Charting library and first charts](#part-3--charting-library-and-first-charts)
- [Part 4 — Coach progress page today](#part-4--coach-progress-page-today)

---

## Part 1 — How grading works

### 1.1 Rating values and special states

Every rating lives in `skill_ratings` (`apps/api/src/db/schema.ts:626`). A rating always resolves to one of:

| State | How stored | Zod shape |
|---|---|---|
| **Grade 1–5** | `grade` 1–5, `not_legal = false`, `no_concept = false` | `grade: 1\|2\|3\|4\|5` |
| **Not legal** | `grade` 1–5 (a "phantom" grade kept so rows still sort), `not_legal = true` | `notLegal: true` + non-null grade |
| **No concept** | `grade = NULL`, `no_concept = true` | `grade: null, noConcept: true` |
| **Not assessed** | No row exists for that `(swimmer, skill, side)` | — |
| **Voided** | `voided_at` + `void_reason` + `void_by` all set | all three required together |

Shared type: `SkillGrade = 1 | 2 | 3 | 4 | 5 | "not_legal" | "no_concept" | null` (`packages/shared/src/lib/dependencyMap.ts:3`).

Rubric meaning of 1–5 is in [`skill-rubric.md`](./skill-rubric.md#rating-scale) (Emerging → Mastery). The DB enforces the state triplet with three check constraints: `grade_xor_no_concept`, `not_legal_requires_grade`, `void_fields_consistent` (`schema.ts:659–683`).

### 1.2 Sides

- Column `side` on `skill_ratings`, enum `"left" | "right"`, nullable (`schema.ts:634`).
- A skill is side-rated when `skills.rated_per_side = true` (`schema.ts:71`). Side-rated skills get **one row per side per session** (never a merged row).
- Collapsing left + right → a single effective grade: `weakerSideGrade(left, right)` (`packages/shared/src/lib/dependencyMap.ts:152`).

```ts
if (left === "not_legal" || right === "not_legal") return "not_legal";
if (both no_concept) return "no_concept";
if (one no_concept)  return the_other;
if (one missing)     return the_other;
return Math.min(l, r);     // weaker side wins
```

Keys in the derived `GradeMap` are `slug` for non-sided skills, `slug:left` / `slug:right` for sided ones (`dependencyMap.ts:121`).

### 1.3 Fault tags

- Separate table `rating_fault_tags(ratingId, faultTag)` (`schema.ts:714`).
- Allowed tags per skill live in `skills.fault_tags` (text[]).
- **Informational only — they do not change the numeric grade.** They are hidden from parents (see 1.10).

### 1.4 Measured values

Two columns on `skill_ratings` for the raw numbers behind a grade (`schema.ts:641–644`):

| Field | Unit enum |
|---|---|
| `capacityValue` | `"yards" \| "reps"` |
| `measurementValue` | `"stroke_cycles_per_minute" \| "stroke_count" \| "seconds" \| "feet"` |

Consistency checks enforce "both value and unit present, or both NULL" (`schema.ts:669–677`). Measurements feed the **golf-score trend** endpoint (1.7) and are displayed next to the grade on the progress page.

### 1.5 Rollups

Skill types (`packages/shared/src/schemas/skills.ts:3`): `rubric | measured | score | composite | rollup`.

**Hierarchy actually computed in code:**

```
raw skill_ratings  (per skill, per side, per session)
        │
        ▼  latestEffectiveRatings()           ← dependencyMap.ts:118
GradeMap  (key = slug or slug:side)
        │
        ├── weakerSideGrade() ────────────► per-skill effective grade
        │
        ├── headPositionOverall() ───────► 1–5 rollup across free/back/breast/fly
        │                                   dependencyMap.ts:98
        │
        ├── calculateStartGrade() ───────► StartGradeResult (track/relay/back start)
        │                                   startGrade.ts:37
        │
        └── findDeepestLowFoundation() ──► coaching priority chain (what to work on next)
                                            dependencyMap.ts:179
```

**No concept / not legal handling in rollups** is consistent:
- `no_concept` is **excluded from the denominator** of averages (floor(avg) over rated components only).
- `not_legal` **counts as 0** in sums, but in start grade an upstream rule makes any `not_legal` component short-circuit the whole start to `not_legal`.
- `null` (not assessed) is excluded from averages; in `calculateStartGrade` any missing component short-circuits to `in_progress`.
- Voided ratings are dropped before rollup by `latestEffectiveRatings` (`dependencyMap.ts:135`).

### 1.6 Start grade

A start (track-start, relay-start, back-start) is a composite over 6 child skills (`skills.parent_skill_id`). `calculateStartGrade(componentSlugs, ratings)` returns a discriminated union (`startGrade.ts:4`):

```ts
{ status: "not_legal" }
{ status: "in_progress", missing: string[] }
{ status: "no_concept" }
{ status: "graded", grade: 1|2|3|4|5 }
```

Rules in order (`startGrade.ts:37`):
1. Any component effective rating is `not_legal` → `not_legal`.
2. Any component has no rating (undefined or null) → `in_progress` with the list of missing slugs.
3. All rated components are `no_concept` → `no_concept`.
4. Otherwise `Math.max(1, Math.floor(sum / count))`, where `no_concept` is excluded and `not_legal` is 0 (unreachable because of rule 1).

Not persisted; computed on-demand in `computeSwimmerProgress` (`apps/api/src/lib/progressCalculation.ts`).

### 1.7 Golf score

In this app the "golf score" is **a measured value on `score`-type skills**, bucketed by phase and compared to a cohort — not a single formula like strokes + time.

- Skills with `skills.type = "score"` (e.g. `free-golf-score`, `back-golf-score`, `fly-golf-score`).
- Each rating stores a `golfScoreCategory` of `"push_off_in_water" | "deck_dive" | "block_dive"` (`schema.ts:645`) and a numeric `measurementValue`.
- Required at write time: score skills must set `golfScoreCategory` unless `noConcept` (`evaluations.ts:163`). Non-score skills must leave it null (`evaluations.ts:170`).
- The rubric grade 1–5 is also stored on the same row — the measured value is the raw number behind the grade.

**Trend endpoint:** `GET /coach/swimmers/:id/golf-score-trends` (`evaluations.ts:711`) → `GolfScoreTrendsResponse`.

For each score skill, grouped by `golfScoreCategory`:
- `points[]` — every non-voided rating with `{ ratedAt, sessionDate, grade, measurementValue }`, ascending.
- `ageBands` — if the swimmer has a birth date and ≥10 other **active** swimmers in the same standard age group have a non-voided measurement for the same `(slug, category)`, compute `{ p25, p50, p75, bandCount }` on their **latest** value each. Otherwise null.

Age groups are the standard swim-meet buckets (6-under, 7-8, 9-10, 11-12, 13-14, 15-18 — see decision 025). Percentile is linear interpolation across the sorted list (`computePercentile`, `evaluations.ts:703`). "Trend" today is just the per-swimmer time-series; there is no computed delta/slope.

### 1.8 Dependency map

- Table `skill_dependencies(skill_id, depends_on_skill_id)` (`schema.ts:92`).
- `BuiltOnGraph` is `Record<slug, dependsOn[]>`. Built once per request in `progressCalculation.ts:152`.
- `findDeepestLowFoundation(targetSlug, grades, graph, sortOrder)` (`dependencyMap.ts:179`) returns a chain from a low-graded target down to its lowest underlying foundation; returns `null` if the target isn't low.
- "Low" (`isLow`, `dependencyMap.ts:79`): grade `≤ 2`, or `not_legal`, or `no_concept`, **or** numerically lower than the thing it supports.
- Tie-break: lowest numeric grade first, then by `sortOrder` ascending.
- If no foundation is "low" but one is `null` (not assessed), it is appended with `notAssessed: true` as a "check it next" suggestion.

Results come back on `SwimmerProgressResponse.coachingPriorities` and feed the "What to work on next" section of the progress page.

### 1.9 Voids and the 10-minute undo

- Constant: `UNDO_WINDOW_MS = 10 * 60 * 1000` (`evaluations.ts:65`).
- `DELETE /ratings/:id` — hard delete, allowed only when `now - rating.createdAt ≤ 10 min` (otherwise 409).
- `PATCH /ratings/:id/void` — soft delete; sets `voidedAt`, `voidReason`, `voidBy`. No time limit.

Effect on calculations:
- Voided ratings are filtered out in `latestEffectiveRatings` → absent from every rollup, start grade, head-position rollup, coaching priority chain, and skill history.
- Trends endpoint uses `isNull(skillRatings.voidedAt)` directly (`evaluations.ts:740`).
- A session is considered voided for coach-note display when every one of its ratings is voided (EXISTS check, `parentProgress.ts:81`).
- The 10-minute delete window matters for charts: a point can **disappear retroactively** inside that window without any void marker. Clients caching a chart must refetch after a delete.

### 1.10 Parent view

Parent route: `GET /parent/swimmers/:id/progress` → `ParentSwimmerProgressResponse` (`parentProgress.ts:35`).

Difference vs the coach response (`SwimmerProgressResponseSchema.omit(...)`, `evaluations.ts:425` area):
- **`faultTags` is omitted from history** (and skipped at compute time when `audience !== "coach"`, `progressCalculation.ts:242`).
- Everything else is the same shape, including `not_legal` / `no_concept` states, voided-filtered history, start grades, head-position overall, and coaching priorities.
- Added for parents: `levelDescriptors` (plain-English rubric text per grade) + `latestCoachingNotes` + `latestCoachingPriority`.
- Parent golf-score trends are not currently exposed — the endpoint is coach-only.
- Access control: `requireParent` + `requireHouseholdMember` middleware.

### 1.11 Worked example

One swimmer, one side-rated skill (`free-bilateral-breathing`), three evaluation sessions.

| Session | Date | Side | grade | not_legal | no_concept | voidedAt |
|---|---|---|---|---|---|---|
| S1 | 2026-10-01 | left | 2 | false | false | null |
| S1 | 2026-10-01 | right | 3 | false | false | null |
| S2 | 2026-10-15 | left | 3 | false | false | null |
| S2 | 2026-10-15 | right | 3 | false | false | null |
| S3 | 2026-10-29 | left | — | true | false | null (phantom grade = 4) |
| S3 | 2026-10-29 | right | 4 | false | false | null |

**Per-side effective (`latestEffectiveRatings`):**
- `free-bilateral-breathing:left` → `"not_legal"` (S3 wins; `notLegal` flag beats the numeric 4).
- `free-bilateral-breathing:right` → `4`.

**Rolled up (`weakerSideGrade`):** `not_legal` on either side → **`not_legal`**.

**Head-position overall** (unrelated skill set — illustrative). Suppose:
- `head-position-free = 3`, `head-position-back = 2`, `head-position-breast = no_concept`, `head-position-fly = null`.
- `headPositionOverall({free:3, back:2, breast:"no_concept"})` → sum = 5, count = 2 (no_concept excluded, null excluded) → `floor(2.5) = 2`.

**Coaching priority.** `free-bilateral-breathing` effective is `not_legal` → `isLow` is true. `findDeepestLowFoundation("free-bilateral-breathing", grades, graph)` walks `builtOn` edges and returns a chain. If `head-position-free = 3` supports it and `horizontal-alignment = 1` supports that in turn, the chain is `[bilateral-breathing (not_legal), head-position-free (3), horizontal-alignment (1)]`. The page shows these three names joined with " → ".

**If S3-left is voided:** `voidedAt` set → `latestEffectiveRatings` falls back to S2-left (grade 3). Weaker side becomes `min(3, 4) = 3`. Coaching priority may no longer apply (not low anymore).

**If S3-left is deleted within 10 minutes:** the row disappears entirely. Same effective result as voiding, but no audit trail.

---

## Part 2 — What we could chart

For each metric: what it is, range, direction (↑/↓ better), whether a historical series is available **today** or needs new code, which endpoint, who sees it, chart shape, where it belongs, and edge cases.

### 2.1 Per-skill grade over time
- **What:** The 1–5 grade for a single skill at each session. Latest-value column per `(swimmer, skill, side)`.
- **Range / direction:** 1–5, ↑ better.
- **History availability:** **Yes, directly from `skill_ratings`**. `SwimmerProgressResponse.skills[].history` already carries the full ordered series per skill (see `SkillChart.tsx:9`).
- **Endpoint today:** `GET /coach/swimmers/:id/progress` and the parent equivalent — no new code needed.
- **Audience:** Coach + parent. Parents must not see fault tags on hover/tooltips.
- **Chart:** Step line + colored dots by context (drill / practice / race). Already prototyped in `SkillChart.tsx`.
- **Where it belongs:** Coach progress (expanded skill row), swimmer profile, parent progress.
- **Edge cases:** `not_legal` → render as a flagged marker at y = 0 (not a drop in the line). `no_concept` → gap in the line, legend note. Voided → omitted. Side-rated → two series on one chart.

### 2.2 Per-skill effective grade (sides collapsed) over time
- **What:** `weakerSideGrade(left, right)` evaluated **as of each session date**.
- **Range / direction:** 1–5 / `not_legal` / `no_concept`, ↑ better.
- **History availability:** **Needs computation.** The server returns both sides' history, but a time-aligned joint "effective" series is not materialized. A pure client function can reduce the two side arrays into one by walking the merged timeline — no new endpoint.
- **Audience:** Both.
- **Chart:** Line; sparkline inline in a skill row.
- **Where:** Progress page skill row header (replace raw L/R badges with the collapsed value + a tiny side-asymmetry marker).
- **Edge cases:** When only one side has ever been rated, draw single-sided line (no asymmetry marker).

### 2.3 Side asymmetry (L − R gap)
- **What:** Numeric gap between left and right effective grades for sided skills.
- **Range / direction:** −4..+4, closer to 0 better.
- **History:** Yes — same source as 2.1.
- **Endpoint:** Progress endpoint today.
- **Audience:** Coach only (noise for parents).
- **Chart:** Diverging bar / small bullet per sided skill, or dotted overlay on 2.2.
- **Edge cases:** One side `no_concept` → "N/A", not a 0 gap.

### 2.4 Head position overall over time
- **What:** `headPositionOverall({ free, back, breast, fly })` evaluated as of each date.
- **Range / direction:** 1–5, ↑ better.
- **History:** **Needs a `computeAsOf(date)` path.** Today the API returns only the current rollup. To render history we'd walk each stroke's full `history[]`, forward-fill to each unique rating date, and recompute. **Perf:** O(sessions × 4) per swimmer — trivial per request, do it in the API in a new field or compute client-side from the existing per-stroke history already shipped.
- **Endpoint:** Add `headPositionHistory: { date, value }[]` to `SwimmerProgressResponse`, or compute client-side.
- **Audience:** Both.
- **Chart:** Line; a hero chart at the top of the page.
- **Edge cases:** No strokes rated → `null`, show empty state.

### 2.5 Category rollup over time
- **What:** For each `skill_categories` row, average effective 1–5 across its skills.
- **Range / direction:** 1–5 continuous, ↑ better.
- **History:** **Needs computeAsOf.** Walk every member skill's history to each unique date, average with `no_concept` excluded and `not_legal = 0`.
- **Endpoint:** New field or new sub-route; cheap but net-new. Shape:
  ```ts
  categoryTrends: { categoryId, categoryName, points: { date, avg: number|null, assessedCount, totalCount }[] }[]
  ```
- **Audience:** Both.
- **Chart:** Small-multiples line, one per category — or a radar for the latest snapshot (see 2.6).
- **Edge cases:** Fewer than 2 skills assessed → suppress or dim.

### 2.6 Category snapshot radar
- **What:** Current average 1–5 per category.
- **Range / direction:** 1–5, ↑ better.
- **History:** Snapshot only (today); animate between dates once 2.5 lands.
- **Endpoint:** Derivable from current progress payload.
- **Audience:** Both.
- **Chart:** Radar (8 categories from the rubric).
- **Where:** Progress page hero.
- **Edge cases:** `no_concept` excluded from denominator; "0/5" labeled "Not assessed" rather than drawn.

### 2.7 Start grade progression
- **What:** `calculateStartGrade(components, history)` evaluated as of each date for track-start / relay-start / back-start.
- **Range / direction:** 1–5 or `not_legal`/`in_progress`/`no_concept`, ↑ better.
- **History:** **Needs computeAsOf.** Walk every component's history; emit a point each time any component changes.
- **Endpoint:** New field on progress response, or a per-start sub-endpoint.
- **Audience:** Both.
- **Chart:** Line with special states as banded regions (red for `not_legal` stretches, grey for `in_progress`).
- **Edge cases:** Status transitions matter more than numeric swings — show markers.

### 2.8 Golf score — raw measurement
- **What:** `measurementValue` on `score`-type skills, grouped by `golfScoreCategory`.
- **Range / direction:** continuous seconds (swim golf = lower better; usually ↓ better).
- **History:** **Available today.** `GET /coach/swimmers/:id/golf-score-trends` returns `points[]` per `(skill, category)`.
- **Audience:** Coach only today; parent eligible (needs route).
- **Chart:** Line + horizontal p25/p50/p75 bands when `ageBands` present.
- **Where:** Coach swimmer page (`GolfScoreTrends.tsx`), can migrate / mirror to coach progress.
- **Edge cases:** `ageBands = null` when cohort < 10 — show "Your trend only." Bands update as peers get rated — not a bug, document it. Age bucket flips on birthday — expect step changes near age-group boundaries.

### 2.9 Golf score — grade
- **What:** 1–5 grade on the same `score` skills.
- **Range / direction:** 1–5, ↑ better.
- **History:** Available today (same endpoint, `points[].grade`).
- **Chart:** Overlay on 2.8 as a secondary axis, or stacked below.
- **Audience:** Both (grade is less abstract than seconds for parents).

### 2.10 Session cadence / recency
- **What:** Count of distinct `evaluation_sessions` per week over last ~12 weeks.
- **Range:** 0..N, ↑ better up to a sane cap.
- **History:** Direct SQL on `evaluation_sessions`.
- **Endpoint:** Not exposed today — add `sessionCounts: { weekStart, count }[]`.
- **Audience:** Coach primarily (operational metric).
- **Chart:** Bar / heatmap-strip.
- **Edge cases:** A session with every rating voided should **not** count — mirror the `EXISTS` filter at `parentProgress.ts:81`.

### 2.11 Coverage: assessed / total per category
- **What:** For each category, `assessed / total` skills ever rated.
- **Range / direction:** 0..1, ↑ better.
- **History:** Available today — just overlay progress response + categories response.
- **Chart:** Progress bar per category; small-multiples.
- **Audience:** Coach (highlights gaps).
- **Edge cases:** `no_concept` counts as assessed (coach made a judgment).

### 2.12 Fault-tag frequency (coach only)
- **What:** Counts of fault tags across the last N sessions, per skill or across all skills.
- **History:** Direct from `rating_fault_tags` (coach response only).
- **Chart:** Horizontal bar, top-N.
- **Edge cases:** Hide for parents. Dedupe within a session.

### 2.13 Context mix (drill / practice / race)
- **What:** Share of ratings taken in each context, overall or per skill.
- **History:** From existing `history[].context`.
- **Chart:** Stacked bar or donut.
- **Audience:** Coach primarily.
- **Edge cases:** Water-confidence sessions can't be `race` — expected zero.

### 2.14 Measurement trends (capacity / measurement)
- **What:** `capacityValue` or `measurementValue` for a chosen skill over time (reps, yards, stroke count, seconds).
- **Range:** continuous; direction depends on unit (reps/yards ↑, stroke_count ↓, seconds ↓).
- **History:** Already in `history[]` on the progress response.
- **Chart:** Line per unit, Y-axis labeled with the unit.
- **Audience:** Both.
- **Edge cases:** Unit must match across points — if a coach changed unit mid-history, split into separate series.

### Note on `computeAsOf(date)`

Metrics 2.4, 2.5, 2.7 need the ability to re-run a rollup "as of" a historical date. The data to do it is already shipped — `history[]` entries carry `ratedAt` and `sessionDate`. The two reasonable homes:

1. **Server:** add a `computeAsOf` layer in `progressCalculation.ts` that iterates over unique rating timestamps and emits a time-series alongside the current snapshot. Cost: linear in total ratings; a swimmer with 500 ratings is a few ms.
2. **Client:** compute from the per-skill histories already on the response. Cheaper to ship, keeps the API narrow, same big-O.

Recommend **client-side first** for Head Position and Category Rollup (fast to ship, no new endpoint); **server-side** for Start Grade (logic lives in `startGrade.ts`, better co-located with other start computations). Decide per-metric, not globally.

---

## Part 3 — Charting library and first charts

### 3.1 What's installed today

Checked `apps/web/package.json` — **no third-party charting library.** The app rolls its own SVG primitives:

- `apps/web/src/components/SkillChart/SkillChart.tsx` — per-skill history line (280 × 80).
- `apps/web/src/components/TrendLine/TrendLine.tsx` — sparkline (64 × 20).
- `apps/web/src/content/CoachSwimmerDetailContent/GolfScoreTrends.tsx` — golf-score chart with p25/p50/p75 bands.

Each uses design tokens (`var(--color-accent)`, `var(--color-danger)`, etc.), works in dark mode automatically via `next-themes`, and renders accessible fallback tables (`SkillChart.tsx:162`).

### 3.2 Recommendation

**Stay custom.** For the chart types in Part 2 (lines, sparklines, bars, radar, heatmap strip), the amount of SVG we'd write is modest, and the hand-rolled components already outperform most libraries on bundle size, dark-mode fidelity, and token adherence. The jg-swim-design skill mandates design-token classes and forbids hex values — any off-the-shelf lib needs a theming layer anyway.

**If we add a lib,** pick one that:
- Is SVG-based (so `fill`/`stroke` take CSS variables directly).
- Is composable (we don't want a monolith "Dashboard" component).
- Has no mandatory CSS import that conflicts with Tailwind v4.

Two credible candidates:

- **Recharts** (~90 kB gz). React-first, SVG, composable, works with CSS variables, good a11y with wrappers. The default go-to if we want speed-to-ship for category rollups / radars.
- **visx** (~15–30 kB gz for the pieces we'd need). Lower-level primitives (scales, axes, shapes). Closer to what we're already doing, more work, but keeps the "we own the SVG" posture.

**Red flags to avoid:** Chart.js (canvas → dark-mode theming becomes imperative, no design-token classes). Nivo (heavier, opinionated styling). Tremor (dashboard-level opinions we don't want).

**Verdict:** keep rolling our own for the first set of charts below. Revisit if we start wanting zoomable brushes, nested tooltips, or multi-series interaction — at that point visx is the better fit than Recharts (keeps the SVG under our control).

### 3.3 Proposed first set, in priority order

1. **Head position overall over time** (2.4) — a single hero line that captures the biggest story on the page. Client-computed from existing data.
2. **Category radar snapshot** (2.6) — one glanceable summary of where the swimmer sits across the 8 rubric categories. No new data.
3. **Category rollup over time, small-multiples** (2.5) — drill-down for the radar.
4. **Golf score with age bands** (2.8) — port the existing `GolfScoreTrends` card into the progress page instead of it living only on the swimmer detail page.
5. **Start grade progression** (2.7) — status-aware line; replaces the current text-only start block.
6. **Per-skill history + L/R + fault tags** (2.1 / 2.3 / 2.12) — expand the current `SkillChart` into the row's expanded panel.
7. **Session cadence** (2.10) — small bar strip in the page header for operational awareness.

Coverage (2.11), context mix (2.13), and measurement trends (2.14) are good follow-ups once the top block is stable.

---

## Part 4 — Coach progress page today

**Route:** `apps/web/src/app/coach/swimmers/[id]/progress/page.tsx` (server component). Fetches three endpoints in parallel: `fetchCoachSwimmerDetail(id)`, `fetchSwimmerProgress(id)` → `GET /coach/swimmers/:id/progress`, `fetchSkillCategories()`. Hands results to `SwimmerProgressContent` (`apps/web/src/content/SwimmerProgressContent/SwimmerProgressContent.tsx`).

### 4.1 What it shows today

In reading order:

1. **Back link + heading.** "← {First Last}" link to `/coach/swimmers/[id]`; H1 "{First}'s Progress". No controls.
2. **"What to work on next"** (`SwimmerProgressContent.tsx:110`). Up to 3 coaching priorities from `progress.coachingPriorities`. Each shows `targetName → chain names`, with `(not assessed yet — check it)` appended for `notAssessed` entries. Plain text; no links.
3. **"Head Position Overall"** (`:145`). Single large accent-colored 1–5 number from `progress.headPositionOverall`. No context — can't tell if it's trending up or how it was computed.
4. **"Starts"** (`:157`). Each start (track/relay/back) shows name + a grade badge. Badge is red when `status === "not_legal"`, otherwise neutral. Below each start, a bordered sub-list of 6 components with their current level (1–5) or "Not assessed". Text like "In progress — needs Head Position, Neck Rotation" is formatted by `formatStartGradeDisplay` (`helpers.ts:20`). No links out.
5. **One section per category** (`:214`). Rendered in the order from `GET /coach/categories`. Each category:
   - Assessed skills first, rendered as `SkillProgressRow` (collapsible). The row header shows name + per-side grade badges + a 64 × 20 sparkline (`TrendLine`) when there are ≥2 history points.
   - Not-assessed skills appended as plain rows that just say "Not assessed".
   - Expanding a row reveals: capacity, measurement, and the full `SkillChart` (280 × 80 line + colored dots + a legend + an `sr-only` table).

**Interactive controls on the page:** only the back link and the per-skill expand/collapse buttons. **No** evaluate button, no add-note, no void, no filter, no sort, no date range, no "see all starts", no deep-link to a skill, no comparison toggle.

### 4.2 What's hard to read / missing

- **No trend for the hero numbers.** Head Position Overall is a single 1–5 with no history, no delta, no indication of direction. Same for every start grade.
- **No cross-skill view.** The reader cannot answer "how is this swimmer doing overall right now?" without manually scanning 8 category sections.
- **Context cues are weak.** `not_legal` only surfaces as a red badge on a start or inside an expanded chart. In the category sections, a `not_legal` skill looks almost identical to a weak one. Same for `no_concept` (shown faintly as "No concept" text when expanded).
- **Low information density, high scroll depth.** Every category gets a section even when empty. Non-assessed skills show as full rows at the bottom of each category rather than as a summary count.
- **Dead-end affordances.** "What to work on next" names a chain but doesn't link to the skill, the drill log, or evaluate flow. Starts in progress list the missing components as text — no click target.
- **Recency hidden.** The page doesn't show when any skill was last evaluated unless the row is expanded. "Last session was 6 weeks ago" is the most actionable signal on this page and it isn't surfaced.
- **No peer context.** Golf score bands exist and are already modeled, but the page shows no cohort/peer comparison for anything.
- **Fault tags buried.** Available in the SR-only table, not surfaced visually. They are the richest coach-only signal and currently invisible.
- **Mobile legibility.** Side-by-side L/R badges + sparkline can wrap awkwardly at the design's `tablet:` breakpoint. Chart `viewBox` is width-responsive but the sibling layout isn't tested at narrow widths.

### 4.3 Part 2 metrics that would move the page most

In priority order (same as 3.3):

1. **Head Position Overall over time (2.4)** — turns the hero number into a hero chart.
2. **Category radar snapshot (2.6) + category rollup over time (2.5)** — replaces the 8-section scroll with one glance + a drill-down.
3. **Start grade progression (2.7)** — the current text-only start block is the weakest part of the page; a status-banded line is a huge upgrade.
4. **Golf score with age bands (2.8)** — this already exists for the swimmer detail page; moving it here surfaces peer context.
5. **Side asymmetry marker (2.3)** — replaces raw L/R badges in the row header with the collapsed effective grade + a small L/R gap indicator.
6. **Session cadence strip (2.10) + "last rated" per skill** — turns recency from invisible into glanceable.
7. **Fault-tag frequency (2.12)** — coach-only block near the top; today it's buried in an SR-only table.
