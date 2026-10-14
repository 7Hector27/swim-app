# Evaluations — Implementation Plan

Source: `docs/reference/skills-rubric-answers-2026-10.md`

---

## Part 1 — Catalog Update PR

All changes to `skillsCatalog.ts` derived from Jason's answers.

### Slug policy

- Every skill that still exists keeps its current slug unchanged.
- Removed skills are archived (e.g. `archived: true` flag), never deleted from the catalog file.
- New skills receive new permanent slugs at the time they are added; slugs are never reused.
- The catalog validation tests are updated to cover all new fields (`faultTags`, `ratedPerSide`) and the archived flag.
- `db:sync-catalog` must run twice in a row with no changes on the second run to confirm idempotency.

### Removals (archived, not deleted)

| Answer | Change |
|--------|--------|
| A2, A5 | Archive shared **body rotation** grade |
| A2, A5 | Archive shared **rhythmic breathing** grade |
| A2 | Archive shared **bilateral breathing** grade |
| A5 | Archive **breaststroke stroke rate** (duplicate of breaststroke tempo) |
| A5 | Archive **backstroke breathing timing** |
| A5 | Archive **backstroke stroke-breath coordination** |
| A12 | Remove "IM breast→free" from freestyle flip turn's `usedIn` list |
| A15 | Remove body rotation link from breaststroke stroke-breath coordination |
| A15 | Remove body rotation link from butterfly stroke-breath coordination |

### Additions (new slugs)

| Answer | Skill added | Category |
|--------|-------------|----------|
| A5 | Freestyle rotation | Freestyle |
| A5 | Backstroke rotation | Backstroke |
| A5 | Freestyle bilateral breathing | Freestyle |
| A5 | Freestyle rhythmic breathing | Freestyle |
| A5 | Butterfly rhythmic breathing | Butterfly |
| A5 | Backstroke rhythmic breathing | Backstroke |
| A5 | Freestyle finishing | Freestyle |
| A5 | Backstroke finishing | Backstroke |
| A5 | Breaststroke finishing | Breaststroke |
| A5 | Butterfly finishing | Butterfly |
| A5 | Backstroke start | Backstroke |
| A5 | Sculling / feel for the water | Technique |
| A5 | Water confidence: submerging | Water confidence |
| A5 | Water confidence: front float | Water confidence |
| A5 | Water confidence: back float | Water confidence |
| A5 | Water confidence: treading water | Water confidence |
| A5 | Water confidence: getting to the wall | Water confidence |
| A4 | Backstroke underwater dolphin kick | Backstroke |
| A11 | Backstroke stroke count | Backstroke |
| A11 | Breaststroke stroke count | Breaststroke |
| A11 | Butterfly stroke count | Butterfly |
| A13 | Fly → back open turn | IM |
| A13 | Back → breast open turn | IM |
| A13 | Back → breast bucket turn | IM |
| A13 | Back → breast crossover turn | IM |
| A13 | Breast → free open turn | IM |

### Splits

| Answer | Before | After |
|--------|--------|-------|
| A4 | Underwater dolphin kick (shared free/fly + back) | Free/fly dolphin kick; Backstroke dolphin kick |
| A5 | Body rotation (shared) | Freestyle rotation; Backstroke rotation |
| A5 | Finishing | Freestyle finishing; Backstroke finishing; Breaststroke finishing; Butterfly finishing |
| A14 | Head position (shared description) | Per-stroke descriptions, shared 1–5 scale |

### Merges

| Answer | Before | After |
|--------|--------|-------|
| A11 | Stroke count + Distance per stroke | Stroke count (per stroke, same measurement) |

### "Builds on" link changes

| Answer | Skill | Old dependency | New dependency |
|--------|-------|---------------|----------------|
| A6 | Buoyancy & balance | (none specified) | Head position (overall), core stability |
| A6 | Each stroke's head position | Buoyancy & balance | (no dependency on buoyancy & balance) |
| A7 | Fly breathing timing | Fly head position, breath control | Fly head position, two-kick rhythm |
| A9 | Fly breakout | Two-kick rhythm | Underwater dolphin kick (free/fly), two-kick rhythm |
| A10 | Freestyle tempo | Stroke timing (unlinked) | Freestyle stroke timing |
| A10 | Backstroke tempo | Stroke timing (unlinked) | Backstroke stroke timing |
| A10 | Breaststroke tempo | Stroke timing (unlinked) | Breaststroke timing |
| A10 | Butterfly tempo | Stroke timing (unlinked) | Two-kick rhythm |
| A15 | Freestyle stroke-breath coordination | Body rotation (shared) | Freestyle rotation |
| A8 default* | Breaststroke breakout | Breaststroke timing | Breaststroke timing |

> *Default — Jason's answer 8 addressed Not legal grading, not the breakout dependency. Assumed breaststroke breakout still builds on breaststroke timing. **Open question #1.**

### New catalog fields

Each skill record gains two new optional fields (empty/null at migration time):

| Field | Type | Purpose |
|-------|------|---------|
| `faultTags` | `string[]` | Common faults the coach can tap when rating (empty at migration; filled in a follow-up PR) |
| `ratedPerSide` | `boolean` | `true` when the skill is graded separately per side (e.g. freestyle bilateral breathing, breathing timing, stroke-breath coordination). The left/right value belongs on ratings, not the skill definition; see PR E-1. |

---

### Open questions for Jason (catalog)

1. **Breaststroke breakout dependency** — Jason's answer 8 answered the Not legal rule, not the original question. Does breaststroke breakout build on breaststroke timing? *(Plan assumes yes.)*
2. **Block setup / stance** — Undecided in answer 5. Add as a 7th start component, or keep 6?
3. **Backstroke rhythmic breathing** — Added based on answer 5 ("rhythmic breathing applies to free, fly and back"), but it was not in the original skill list. Confirm this is intentional.
4. **Free/fly dolphin kick name** — "Underwater dolphin kick (free/fly)" is long; confirm preferred display name.
5. **Backstroke dolphin kick rubric** — Needs a separate rubric with a higher speed/distance standard. Who writes it?

---

## Part 2 — Evaluations PRs

PR order: E-0 → E-1 → E-2 → E-3 → E-4 → E-5. Each depends on the previous. E-5 is blocked pending Jason's answers to questions 20–25.

---

### PR E-0: Dependency map — pure function + tests (`packages/shared`)

A standalone, pure function with no database dependency that takes a map of `{ skillSlug → grade | "not_legal" | "no_concept" | null }` and the catalog's `buildsOn` graph, and returns the deepest low foundation skill.

**Lowness rules applied by the function:**

- Grade ≤ 2 → low.
- Grade < the grade of the skill it supports → low.
- `not_legal` → always low.
- `no_concept` → always low.
- `null` (not assessed / voided) → treated as not rated; not counted as low and not descended into.

**Traversal:** walk the `buildsOn` chain from the target skill; keep descending while each ancestor is also low; stop at the first ancestor that isn't. Return the deepest low skill found.

**Note — `head-position-overall` in the chain:** `buoyancy-balance` builds on `head-position-overall`, which is a rollup calculated from whichever per-stroke head positions have already been rated (answer 16: average of rated strokes, rounded down; unrated strokes excluded). The function receives the computed rollup value, not a per-stroke breakdown. This means reaching `head-position-overall` in the chain does not require all four strokes to be assessed — it uses whatever is available, and the chain can proceed or stop based on that value.

**Test file covers:**

- Grade 2-or-below counts as low.
- Grade lower than the skill it supports counts as low.
- `not_legal` always counts as low.
- `no_concept` always counts as low.
- Voided / null ratings are ignored (not treated as low, chain stops there).
- Chain follows multiple steps while each is low.
- Chain stops at the first skill that isn't low.
- Returns the target skill itself when no lower-priority blocker exists.

This PR has no migration. It ships before any API or DB work so E-3 can import it directly.

---

### PR E-1: Database schema — evaluation sessions + ratings core

**Evaluation sessions**

Every set of ratings lives inside a session. A session is one coach observing one swimmer in one sitting.

`evaluation_sessions` columns: `id`, `swimmer_id`, `coach_id`, `category` (e.g. freestyle, starts, IM turns), `session_date`, `context` (`drill | practice | race`), `coaching_priority` (text, required — written by Jason; the dependency-map suggestion is displayed as a hint in the UI but what Jason types is what's stored), `created_at`.

**Ratings**

`skill_ratings` columns: `id`, `session_id` (FK → `evaluation_sessions`), `swimmer_id`, `skill_id`, `coach_id`, `grade` (1–5 integer), `not_legal` (boolean), `no_concept` (boolean), `side` (`left | right | null`), `capacity_value` (numeric, nullable), `capacity_unit` (`yards | reps | null`), `measurement_value` (numeric, nullable), `measurement_unit` (`stroke_cycles_per_minute | stroke_count | seconds | feet | null`), `note` (text, nullable), `voided_at`, `void_reason`, `void_by` (coach_id), `rated_at`, `created_at`.

`rating_fault_tags` join table: `rating_id`, `fault_tag` (string).

**Grading semantics stored (not derived)**

- `grade`: the phantom 1–5 even when `not_legal = true`.
- `not_legal` and `no_concept` are stored flags; the app derives how each counts.
- Voided ratings keep their row; `voided_at`, `void_reason`, and `void_by` are set.

**Exclusion rules — applied in every calculation (averages, rollups, start grade, head position, charts, dependency map)**

| State | Averages & rollups | Dependency map |
|-------|-------------------|----------------|
| Voided | Ignored completely — as if the rating never existed | Ignored (treated as null / not assessed) |
| Not legal | Counts as 0 | Always counts as low |
| No concept | Not counted (excluded from denominator) | Always counts as low |
| Not assessed (no row) | Excluded | Not rated; chain stops there |

**Cross-table rules enforced in E-3 (not the DB):**
- `side` is only allowed when `skills.rated_per_side = true`.
- Each `fault_tag` must be in `skills.fault_tags` for the rated skill.
- The session's `category_id` must match the skill's `category_id`.

**Migration note**: migration must be applied locally and called out in the PR description.

---

### PR E-2: Database schema — start ratings

`start_ratings` columns: `id`, `session_id` (FK → `evaluation_sessions`), `swimmer_id`, `coach_id`, `stroke` (for backstroke start), `rated_at`, `voided_at`, `void_reason`, `void_by`.

`start_component_ratings` columns: `start_rating_id`, `component` (enum: `reaction_time`, `block_position`, `entry_angle`, `entry_point`, `streamline`, `breakout`), `grade` (1–5), `not_legal` (boolean).

**Calculated at read time (never stored):**

- Start grade: `floor(avg(component grades))`, treating `not_legal` as 0 (voided start ratings excluded entirely). "In progress" when fewer than 6 components are rated.
- If any component is `not_legal`, the whole start is flagged Not legal.

---

### PR E-3: API — rating endpoints

Routes (all under `/api/v1`):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/swimmers/:id/sessions` | Create a new evaluation session |
| POST | `/sessions/:id/ratings` | Save a new skill rating inside a session |
| POST | `/sessions/:id/start-ratings` | Save a new start rating inside a session |
| DELETE | `/ratings/:id` | Undo a rating (within 10 minutes of `created_at` only; returns 409 after) |
| PATCH | `/ratings/:id/void` | Void a rating with a reason |
| GET | `/swimmers/:id/sessions` | List sessions for a swimmer |
| GET | `/swimmers/:id/skills/:skillId/ratings` | History for one skill (latest non-voided) |
| GET | `/swimmers/:id/skills` | All skill grades for a swimmer (latest non-voided per skill) |

**Permissions — enforced on every route above:**

- Only authenticated coaches may call any of these endpoints.
- A coach may only create sessions for swimmers on their roster.
- A coach may only undo or void ratings they created. `void_by` must be set to the authenticated coach's profile ID — never to a different profile. The DB trigger does not enforce identity; the API must.
- Parents have no access to sessions or ratings. These routes return 403 for parent-role tokens. Access for parents is deferred to a later parent view PR.
- Tests for each route must include: coach succeeds, parent gets 403, unauthenticated gets 401.

**Calculation rules (read path, never stored):**

- Exclusion rules from E-1 apply to all calculations.
- Head position overall: `floor(avg(rated stroke head positions))`, excluding unrated strokes and applying exclusion rules.
- Start grade: `floor(avg(component grades))`, treating `not_legal` as 0; "in_progress" if < 6 components.
- Dependency map: call the pure function from E-0 with the swimmer's current (non-voided) grades.

---

### PR E-4: Web — rating entry screen

**Screens**

- Create session: pick swimmer, category, date, context (drill / practice / race), and write a coaching priority. The dependency-map suggestion for the swimmer is shown as hint text next to the coaching priority field; what the coach types is what's saved.
- Rate a skill: 1–5 tap grid + "Not legal" toggle + "No concept" toggle + fault tag chips + optional note field + optional capacity (value + unit) + optional measurement (value + unit; pre-filled unit for skills with a fixed unit such as tempo → stroke cycles per minute).
- Bilateral / breathing skills: left/right side selector shown before grading.
- Starts: one screen per component with an In Progress indicator; overall calculated grade shown after all 6 are done.
- 10-minute undo toast after saving (disappears when window closes or timer expires).
- Void modal: free-text reason, confirms before saving. Only the creating coach sees the void option.

**Visual indicators**

- Not legal: red "DQ" badge on the skill card and on any rollup that includes it.
- No concept: distinct label; excluded from averages.
- In progress (starts): progress indicator showing how many of 6 components are rated.
- Voided ratings: hidden from charts and averages; visible in full history view with reason and voiding coach shown.

**Permissions:** UI routes for session creation and rating are coach-only. Parent-role users do not see these screens.

---

### PR E-5: Web — swimmer progress view ⛔ BLOCKED

**Blocked on Jason's answers to questions 20–25:**

20. Measured skills grading — how are tempo, stroke count, reaction seconds, and start distance graded alongside the 1–5 scale?
21. Evaluation frequency — how often should evaluations happen, and does the app enforce or suggest a cadence?
22. Drill vs. race on charts — are drill and race context ratings shown together or separated on the progress chart?
23. Capacity on charts — is capacity (yards/reps) displayed on progress charts or used only for context?
24. What parents see — which skills, grades, or summaries are visible to parents, and in what form?
25. Example chart — what does a useful progress chart actually look like for a swimmer?

**Intended scope (design only, implementation after answers):**

- Per-skill history chart; exclusion rules applied (voided hidden, not-legal as 0, no-concept excluded).
- Head position summary card: per-stroke grades + calculated overall.
- Start card: per-component grades + calculated overall or "In progress".
- Priority coaching flag: deepest low foundation skill from the dependency map, surfaced at top of profile.
- Tempo cards: grade + measurement value (cycles per minute) alongside.
- Capacity shown on session detail; chart behavior depends on Q23.

**Parent-facing data rules (enforced in every E-5 response schema):**

- `skill_ratings.note` is never returned to parents. It is a coach observation field.
- `skill_ratings.void_reason` and `void_by` are never returned to parents.
- `evaluation_sessions.coaching_priority` visibility is **pending Jason's answer to question 24**. Until that answer is received, treat it as coach-only and omit it from all parent-facing responses.
- Parent-facing schemas must be defined as separate Zod schemas (e.g. `SkillRatingParentSchema`) that omit coach-only fields, not by filtering at serialisation time.

---

### Open questions for Jason (evaluations)

1. **7th start component** — Block setup / stance: include in start ratings schema now, or add later? Adding it later requires a migration and leaves historical starts missing that component. *(Plan defaults to 6 components.)*
2. **Illegal turns** — Turns rated Not legal: phantom 1–5 + red DQ (same as answer 8), or cap at 2? *(Plan defaults to the Not legal rule: phantom grade, red DQ, counts as 0.)*
3. **Fault tag content** — Catalog ships with empty fault tag lists. Who populates them, and in what PR?
4. **Backstroke rhythmic breathing** — Confirm this skill should exist (see catalog open question #3).
5. **Not assessed vs. No concept UI** — Should "No concept" be a tap option on the rating screen, or reserved for a separate observation flow?
6. **Void permissions** — Can a coach void only their own ratings, or can an admin void any coach's rating?
7. **Side tracking scope** — Should any skill other than freestyle breathing track side (e.g. freestyle rotation)?
8. **No concept toward "all 6 rated"** — Does a no_concept component rating count as one of the 6 required components for a start grade, or does it leave the start "In progress"? *(Implementation currently counts it as rated and excludes it from the average.)*
9. **Component rating expiry** — Should a component rating from an old session still count toward the current start grade, or should ratings expire (e.g. after N months) so stale components fall out?
20. **Measured skills grading** — How are tempo, stroke count, reaction seconds, and start distance graded alongside the 1–5 scale? *(Blocks E-5.)*
21. **Evaluation frequency** — How often should evaluations happen? Does the app enforce or suggest a cadence? *(Blocks E-5.)*
22. **Drill vs. race on charts** — Are drill and race context ratings shown together or separated on progress charts? *(Blocks E-5.)*
23. **Capacity on charts** — Is capacity (yards/reps) shown on progress charts or used only for session context? *(Blocks E-5.)*
24. **What parents see** — Which skills, grades, or summaries are visible to parents, and in what form? *(Blocks E-5.)*
25. **Example chart** — What does a useful progress chart actually look like for a swimmer? *(Blocks E-5.)*
