# Skills Screens Update Plan

Derived from `docs/reference/decisions-screens-skills-2026-10-14.md`.

---

## PR 1 — Catalog update ✓ (done, commit ba8513d)

- Archive 5 shared skills (`horizontal-alignment`, `hip-position`, `free-breathing-mechanics`, `breast-breathing`, `back-start-streamline`) with `archived: true` in catalog — slugs are permanent, never deleted
- Add 11 new skills: per-stroke `horizontal-alignment` and `hip-position` for free / back (hip only; `back-body-alignment` is backstroke's alignment skill) / breast / fly, plus `streamline-in-motion` and golf scores for free / back / fly
- Rename "Breathing timing" → "Breath timing" (×3); "Stroke hold on breath" → "Stroke integrity on breath" (×3); `breast-propulsion-efficiency` name → "Golf score"
- Replace the 7 dependency links that pointed at the archived shared skills — only those links; no new links added to any skill
- `CatalogSkill.archived` flag; `syncCatalogFn` updated; validation rejects active → archived deps

---

## PR 2 — Level descriptors ✓ (done, commit 25aff41)

### Data layer

**`skillsCatalog.ts`** — add descriptors + fault tags:

- `exhalation`: fault tags `["holds breath", "exhales above water", "empties too early"]`; 5 descriptors (decisions doc lines 81–86)
- `breathing-timing-free` ("Breath timing", free): 5 descriptors (lines 88–92); no new fault tags
- `stroke-breath-coordination-free` ("Stroke integrity on breath", free): fault tags `["lead arm drops", "kick stops", "stroke pauses", "hips sink", "over-rotates"]`; 5 descriptors (lines 94–98)
- `breathing-timing-fly` ("Breath timing", fly): 5 descriptors (lines 101–105); no new fault tags
- `breathing-timing-breast` ("Breath timing", breast): fault tags `["lifts early", "lifts late", "surfaces late", "returns too slow", "returns too fast", "stays up through the kick"]`; 5 descriptors (lines 109–113)

Run `pnpm db:sync-catalog` to push descriptors and fault tags to DB.

### Shared schema

**`packages/shared/src/schemas/evaluations.ts`** — `SkillForRatingSchema`:
- Add `descriptors: z.array(z.object({ level: z.number().int().min(1).max(5), text: z.string() }))` (required; empty array when none)

### API — GET /categories

**`apps/api/src/routes/evaluations.ts`** (coachCategoriesRouter):
- After fetching skills, query `skillLevelDescriptors`; include `descriptors: [{level, text}]` on each skill (empty array when none)

### Web — SkillGradeRow

**`apps/web/src/content/EvaluateContent/SkillGradeRow.tsx`**:
- When `skill.descriptors` is non-empty and a grade is selected, show the matching descriptor text inline below the grade selector

### Tests

- `skillsCatalog.test.ts`: the 5 skills each have exactly 5 descriptors; the 3 skills have the correct fault tags
- `evaluations.test.ts`: `GET /categories` response includes `descriptors` array on every skill

---

## PR 3 — Screen model, breathing pattern, sections, stroke labels

Replace the category-based session model with a per-stroke screen model; add breathing pattern as a session field; update section layouts to include cross-category skills; and refine stroke labelling so stroke names appear once.

### Terminology

This plan uses "coach role" throughout (the user's role is `coach`; the pool of swimmers they work with is not called a roster).

### DB migration

**`evaluationSessions`**:
- Add `screenSlug text NOT NULL` — the screen the coach was evaluating (e.g. `"freestyle"`, `"backstroke"`, `"fundamentals"`).
- Add `breathingPattern text` (nullable) — the breathing pattern observed during this session. Valid values: `"every_1"`, `"every_2"`, `"every_3"`, `"every_4"`, `"every_5"`, `"other"`. Populated only on `freestyle` and `butterfly` sessions.
- Deprecate `categoryId` — keep the column and FK for existing rows; new sessions write `screenSlug` and leave `categoryId` null (or migrate existing rows by deriving screen from category).

**`swimmers`**:
- Add `recommendedBreathingPattern text` (nullable) — same fixed-option enum as above. Coach-set field on the swimmer's profile.

Generate migrations with `pnpm db:generate`.

### Shared schema

**`packages/shared/src/schemas/evaluations.ts`**:
- Add `BreathingPatternSchema = z.enum(["every_1","every_2","every_3","every_4","every_5","other"])` and export `type BreathingPattern`.
- `CreateSessionBodySchema`: replace `categoryId` with `screenSlug: z.string()`; add `breathingPattern: BreathingPatternSchema.nullable()` (required, null when not applicable).
- `SkillForRatingSchema`: add `stroke: StrokeSchema.nullable()` (required).

**`packages/shared/src/lib/screenSkills.ts`** (new file):
- Export `SCREEN_SKILLS: Record<string, string[]>` — a flat list of every skill slug that can be rated on each screen. This is the authoritative list used by the API to validate submitted ratings.
- Screen slugs and their full skill lists (including cross-category skills, shared skills, and start component slugs):

  | Screen slug | Skill slugs |
  |---|---|
  | `fundamentals` | all active skills in `body-position-balance` |
  | `water-confidence` | all skills in `water-confidence` |
  | `freestyle` | free-head-position, free-horizontal-alignment, free-hip-position, free-rotation, free-reach-before-entry, free-catch, free-pull, free-recovery, free-kick, free-stroke-timing, free-kick-rate, free-tempo, free-stroke-count, free-golf-score, free-finishing, breathing-timing-free, stroke-breath-coordination-free, free-rhythmic-breathing, free-bilateral-breathing, track-start, track-start-reaction, track-start-acceleration, track-start-height, track-start-distance, track-start-head-arm-hand, track-start-leg-feet, relay-start, relay-start-reaction, relay-start-acceleration, relay-start-height, relay-start-distance, relay-start-head-arm-hand, relay-start-leg-feet, push-off, streamline-in-motion, udk-free, breakout-free, wall-approach, freestyle-flip-turn |
  | `backstroke` | back-head-position-stability, back-body-alignment, back-hip-position, back-rotation, back-reach-before-entry, back-catch, back-pull, back-arm-recovery, back-kick, back-swimming-straight, back-stroke-timing, back-kick-rate, back-tempo, back-stroke-count, back-golf-score, back-finishing, back-rhythmic-breathing, back-start, back-start-reaction, back-start-push, back-start-arch, back-start-distance, back-start-entry-alignment, push-off, streamline-in-motion, udk-back, breakout-back, wall-approach, backstroke-flip-turn |
  | `breaststroke` | breast-head-position, breast-horizontal-alignment, breast-hip-position, breast-kick-mechanics, breast-arm-pull, breast-timing, breast-glide, breast-streamline-recovery, breast-tempo, breast-stroke-count, breast-propulsion-efficiency, breast-finishing, breathing-timing-breast, stroke-breath-coordination-breast, track-start, track-start-reaction, track-start-acceleration, track-start-height, track-start-distance, track-start-head-arm-hand, track-start-leg-feet, relay-start, relay-start-reaction, relay-start-acceleration, relay-start-height, relay-start-distance, relay-start-head-arm-hand, relay-start-leg-feet, push-off, streamline-in-motion, pullout, breakout-breast, wall-approach, breaststroke-open-turn |
  | `butterfly` | fly-head-position, fly-horizontal-alignment, fly-hip-position, fly-body-undulation, fly-dolphin-kick, fly-reach-before-entry, fly-catch, fly-pull, fly-arm-recovery, fly-two-kick-rhythm, fly-kick-rate, fly-tempo, fly-stroke-count, fly-golf-score, fly-finishing, breathing-timing-fly, stroke-breath-coordination-fly, fly-rhythmic-breathing, track-start, track-start-reaction, track-start-acceleration, track-start-height, track-start-distance, track-start-head-arm-hand, track-start-leg-feet, relay-start, relay-start-reaction, relay-start-acceleration, relay-start-height, relay-start-distance, relay-start-head-arm-hand, relay-start-leg-feet, push-off, streamline-in-motion, udk-fly, breakout-fly, wall-approach, butterfly-open-turn |
  | `starts` | track-start, track-start-reaction, track-start-acceleration, track-start-height, track-start-distance, track-start-head-arm-hand, track-start-leg-feet, relay-start, relay-start-reaction, relay-start-acceleration, relay-start-height, relay-start-distance, relay-start-head-arm-hand, relay-start-leg-feet, back-start, back-start-reaction, back-start-push, back-start-arch, back-start-distance, back-start-entry-alignment, push-off, streamline-in-motion |
  | `im-turns` | im-fly-to-back, im-back-to-breast-open, im-back-to-breast-bucket, im-back-to-breast-crossover, im-breast-to-free |
  | `racing` | pacing, speed-endurance, race-strategy, race-awareness, adaptability |
  | `breathing` | exhalation, breath-control, breathing-timing-free, stroke-breath-coordination-free, free-rhythmic-breathing, free-bilateral-breathing, back-rhythmic-breathing, breathing-timing-breast, stroke-breath-coordination-breast, breathing-timing-fly, stroke-breath-coordination-fly, fly-rhythmic-breathing |

- `SCREEN_SLUGS: readonly string[]` — the ordered list of valid screen slug values, for use in Zod enum.

### API

**`POST /coach/swimmers/:id/sessions`** — update validation:
- Accept `screenSlug` instead of `categoryId`; validate it is a known screen slug (member of `SCREEN_SLUGS`).
- Validate every submitted skill ID is in `SCREEN_SKILLS[screenSlug]` (resolved to IDs after loading the skill table). Return 422 if any skill is outside the screen.
- Validate `breathingPattern` is non-null if and only if `screenSlug` is `"freestyle"` or `"butterfly"`.

**`GET /coach/screens`** (new route, replaces `GET /categories` for the evaluation form):
- Returns the list of screens with their skills (fetched by joining skills whose slugs are in each screen's `SCREEN_SKILLS` entry), including `descriptors`, `stroke`, `ratedPerSide`, `notLegalAllowed`, `faultTags`, `parentSkillId`, `sortOrder`.
- Response shape mirrors the current `CategoriesResponse` but keyed by screen slug rather than category slug.
- Keep `GET /categories` in place for backward compatibility until all callers migrate.

**`PATCH /coach/swimmers/:id`** — add `recommendedBreathingPattern` as an optional patchable field (same validation as breathing pattern enum, nullable to clear).

### Shared schema (GET /screens response)

Add `ScreenWithSkillsSchema` and `ScreensResponseSchema` to `packages/shared/src/schemas/evaluations.ts`, mirroring the existing category shapes but using `screenSlug` instead of `categoryId`.

### Web — screen section config

**`apps/web/src/content/EvaluateContent/screenSections.ts`** — replace category-slug keys with screen-slug keys and expand section skill lists to match the screen model. Start sections list the start's component skills alongside `push-off` and `streamline-in-motion`:

| Screen | Sections |
|---|---|
| `freestyle` | Start (track-start + its 6 components + push-off + streamline-in-motion), Underwaters (udk-free), Breakout (breakout-free), The swim (stroke skills + breathing skills), The wall (wall-approach, freestyle-flip-turn), Numbers (kick-rate, tempo, stroke-count, golf-score, finishing) |
| `backstroke` | Start (back-start + its 5 components + push-off + streamline-in-motion), Underwaters (udk-back), Breakout (breakout-back), The swim, The wall, Numbers |
| `breaststroke` | Start (track-start + its 6 components + push-off + streamline-in-motion), Underwaters (pullout), Breakout (breakout-breast), The swim, The wall (wall-approach, breaststroke-open-turn), Numbers |
| `butterfly` | Start (track-start + its 6 components + push-off + streamline-in-motion), Underwaters (udk-fly), Breakout (breakout-fly), The swim, The wall (wall-approach, butterfly-open-turn), Numbers |
| `fundamentals` | Fundamentals (all active swimmer-level skills) |
| `breathing` | Swimmer-level (exhalation, breath-control); Freestyle; Backstroke; Breaststroke; Butterfly |
| `starts` | Track start (composite + 6 components + push-off + streamline-in-motion); Relay start (composite + 6 components + push-off + streamline-in-motion); Backstroke start (composite + 5 components + push-off + streamline-in-motion) |
| `im-turns` | IM Turns (all 5 turns) |
| `racing` | Racing (all 5 skills) |
| `water-confidence` | Water Confidence (all 5 skills) |

### Web — helpers

**`apps/web/src/content/EvaluateContent/helpers.ts`**:
- `buildSectionGroups(screenSkills, sections)`: unchanged in signature and behaviour (skills not in any section → "Other").
- `skillDisplayLabel(skill, sectionName)`: stroke name appears **once** — as the section heading — not repeated per skill row. Within a section whose name matches a stroke (e.g. section named `"Freestyle"` or `"Backstroke"`), return `skill.name` only. For skills outside a stroke-named section, return `skill.name` only (the section heading carries the context). Remove the `allSkills` duplicate-name detection; the section name is the sole source of stroke context.

### Web — EvalSectionHeader

**`apps/web/src/content/EvaluateContent/EvalSectionHeader.tsx`**:
- Collapsible; starts expanded; shows section name + skill count; token-only styling.
- No change to the component contract from what is already built.

### Web — EvaluateContent

**`apps/web/src/content/EvaluateContent/EvaluateContent.tsx`**:
- Call `GET /coach/screens` instead of `GET /categories`.
- Session setup uses `screenSlug` instead of `categoryId`.
- When screen is `freestyle` or `butterfly`, show the breathing pattern selector (see SessionSetup below).
- Render skills in collapsible sections using `EvalSectionHeader` and `buildSectionGroups`; labels use `skillDisplayLabel(skill, sectionName)`.
- Fall back to flat list when no section config exists for the screen slug.

### Web — SessionSetup

**`apps/web/src/content/EvaluateContent/SessionSetup.tsx`**:
- Replace category dropdown with screen dropdown.
- When screen is `freestyle` or `butterfly`, show a required breathing pattern field: a button group or select with options _Every stroke_, _Every 2_, _Every 3_, _Every 4_, _Every 5_, _Other_.
- If `draft.sessionDate === todayLA()`, render warning: _"Session date is today — change it if rating from memory."_

### Web — Swimmer profile

**`apps/web/src/content/CoachSwimmerDetailContent/`** (or the coach swimmer edit path):
- Add a "Recommended breathing pattern" field for the coach to set on each swimmer's profile. Same fixed options as the session field. Nullable (leave blank if not yet set).

### Golf score display (swimmer profile)

On the swimmer profile progress view, golf score is displayed as:
- The swimmer's own trend over time (always shown once any golf score exists).
- Age-group bands for context: bands are shown only once at least **10** swimmers in the same age group have a golf score for that stroke — confirm threshold of 10 with Jason before shipping. Until the threshold is met, show "trend only" with no band overlay.
- Not shown on the public leaderboard.

### Tests

- `evaluations.test.ts`: `POST /sessions` accepts `screenSlug`, rejects skill IDs outside the screen's list, rejects `breathingPattern` on non-free/fly screens, rejects null `breathingPattern` on free/fly screens
- `evaluations.test.ts`: `GET /screens` returns skills with `descriptors`, `stroke`, cross-category skills present on the correct screens
- `swimmers.test.ts`: `PATCH /coach/swimmers/:id` accepts `recommendedBreathingPattern`
- `screenSkills.test.ts` (shared): every slug in `SCREEN_SKILLS` exists in the catalog; no slug appears under an archived skill; `SCREEN_SLUGS` matches the keys of `SCREEN_SKILLS`
- `helpers.test.ts`: `skillDisplayLabel` returns `skill.name` without stroke suffix; `buildSectionGroups` unchanged
- `evaluateScreen.test.tsx`: breathing pattern selector appears for freestyle/butterfly screens; absent for others

---

## Status on this branch

Commits: ba8513d (PR 1), 25aff41 (PR 2), 55cd0a9 (PR 3 partial), 0e73a58 (DB migration), 1c1793a (PR 3 complete).

### PR 1

| Item | Status |
|---|---|
| Archive 5 shared skills with `archived: true` | **Done** — ba8513d |
| Per-stroke horizontal-alignment and hip-position (free / back / breast / fly) | **Done** — ba8513d |
| streamline-in-motion, golf scores for free / back / fly | **Done** — ba8513d |
| Renames (Breath timing ×3, Stroke integrity ×3, Golf score) | **Done** — ba8513d |
| Replace 7 dep links that pointed at archived shared skills; no new links | **Done** — ba8513d |
| `CatalogSkill.archived` flag; syncCatalogFn; active→archived validation | **Done** — ba8513d |
| `pnpm db:sync-catalog` run twice (second run idempotent) | **Not done** — run `pnpm db:up && pnpm db:migrate && pnpm db:sync-catalog` twice |

### PR 2

| Item | Status |
|---|---|
| Descriptors (5 levels) for exhalation, breathing-timing-free, stroke-breath-coordination-free, breathing-timing-fly, breathing-timing-breast | **Done** — 25aff41 |
| Fault tags for exhalation, stroke-breath-coordination-free, breathing-timing-breast | **Done** — 25aff41 |
| `SkillForRatingSchema`: `descriptors` field | **Done** — 25aff41 |
| GET /categories: includes descriptors per skill | **Done** — 25aff41 |
| SkillGradeRow: inline descriptor text for selected grade | **Done** — 25aff41 |
| Tests (descriptor counts, fault tags, API response) | **Done** — 25aff41 |
| `pnpm db:sync-catalog` to push descriptors/fault tags | **Not done** — run manually after `pnpm db:up` |

### PR 3

| Item | Status |
|---|---|
| `SkillForRatingSchema`: `stroke` field | **Done** — 55cd0a9 |
| GET /categories: includes `stroke` per skill | **Done** — 55cd0a9 |
| `EvalSectionHeader` component (collapsible, token styling) | **Done** — 55cd0a9 |
| `buildSectionGroups` in helpers.ts (now takes flat skill list) | **Done** — 1c1793a |
| SessionSetup: today-date warning | **Done** — 55cd0a9 |
| `screenSections.ts`: screen-slug keys, cross-category skills, start sections include components + push-off + streamline-in-motion | **Done** — 1c1793a |
| `skillDisplayLabel`: returns `skill.name` only (section heading carries stroke context) | **Done** — 1c1793a |
| EvaluateContent: calls GET /screens, uses screenSlug, cross-category skills, collapsible sections | **Done** — 1c1793a |
| `BreathingPatternSchema` enum | **Done** — 1c1793a |
| DB migration: `screenSlug` on `evaluationSessions` | **Done** — 0e73a58 (not applied locally yet) |
| DB migration: `breathingPattern` on `evaluationSessions` | **Done** — 0e73a58 (not applied locally yet) |
| DB migration: `recommendedBreathingPattern` on `swimmers` | **Done** — 0e73a58 (not applied locally yet) |
| `SCREEN_SKILLS` map in shared (authoritative per-screen skill list) | **Done** — 1c1793a |
| `CreateSessionBodySchema`: `screenSlug` replaces `categoryId`; `breathingPattern` field | **Done** — 1c1793a |
| POST /sessions: validates `screenSlug`; validates skills against screen list | **Done** — 1c1793a |
| GET /coach/screens (new route, alongside GET /categories) | **Done** — 1c1793a |
| PATCH /coach/swimmers/:id: `recommendedBreathingPattern` field | **Done** — 1c1793a |
| SessionSetup: screen picker replacing category picker | **Done** — 1c1793a |
| SessionSetup: breathing pattern selector for free/fly screens | **Done** — 1c1793a |
| Swimmer profile: recommended breathing pattern field | **Done** — 1c1793a |
| Tests (POST /sessions with screenSlug, GET /screens, breathing pattern, screen skill validation) | **Done** — 1c1793a |
| Golf score trend: age-group bands at threshold 10 (confirm with Jason); trend-only below threshold | **Not done** — separate PR |
