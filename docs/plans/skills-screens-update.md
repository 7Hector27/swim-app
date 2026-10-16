# Skills Screens Update Plan

Derived from `docs/reference/decisions-screens-skills-2026-10-14.md`.

---

## PR 1 — Catalog update ✓ (done, commit ba8513d)

See commit for full list. Summary:
- Archive 5 shared skills (`horizontal-alignment`, `hip-position`, `free-breathing-mechanics`, `breast-breathing`, `back-start-streamline`) with `archived: true` in catalog
- Add 11 new skills: per-stroke `horizontal-alignment` and `hip-position` for free/back/breast/fly, plus `streamline-in-motion` and golf scores for free/back/fly
- Rename "Breathing timing" → "Breath timing" (×3); "Stroke hold on breath" → "Stroke integrity on breath" (×3); `breast-propulsion-efficiency` name → "Golf score"
- Update 7 dep links that pointed at the archived shared skills
- `CatalogSkill.archived` flag; syncCatalogFn updated accordingly

---

## PR 2 — Level descriptors

Add the rubric descriptors and missing fault tags from the decisions doc to the catalog, expose them through the API, and surface them in the evaluation form.

### Data layer

**`skillsCatalog.ts`** — add descriptors + fault tags:

- `exhalation`:
  - fault tags: `["holds breath", "exhales above water", "empties too early"]`
  - descriptors (5 levels from decisions doc lines 81–86)

- `breathing-timing-free` ("Breath timing", free):
  - descriptors (5 levels from decisions doc lines 88–92)
  - _(no new fault tags)_

- `stroke-breath-coordination-free` ("Stroke integrity on breath", free):
  - fault tags: `["lead arm drops", "kick stops", "stroke pauses", "hips sink", "over-rotates"]`
  - descriptors (5 levels from decisions doc lines 94–98)

- `breathing-timing-fly` ("Breath timing", fly):
  - descriptors (5 levels from decisions doc lines 101–105)
  - _(no new fault tags)_

- `breathing-timing-breast` ("Breath timing", breast):
  - fault tags: `["lifts early", "lifts late", "surfaces late", "returns too slow", "returns too fast", "stays up through the kick"]`
  - descriptors (5 levels from decisions doc lines 109–113)

Run `pnpm db:sync-catalog` to push descriptors and fault tags to DB.

### Shared schema

**`packages/shared/src/schemas/evaluations.ts`** — `SkillForRatingSchema`:
- Add `descriptors: z.array(z.object({ level: z.number().int().min(1).max(5), text: z.string() }))` (required; empty array when none)

### API — GET /categories

**`apps/api/src/routes/evaluations.ts`** (coachCategoriesRouter):
- After fetching skills, query `skillLevelDescriptors` for those skill IDs
- Include `descriptors: [{level, text}]` on each skill in the response (empty array when none)

### Web — SkillGradeRow

**`apps/web/src/content/EvaluateContent/SkillGradeRow.tsx`**:
- When `skill.descriptors` is non-empty and a grade is selected, show the matching descriptor text inline below the grade selector

### Tests

- `skillsCatalog.test.ts`: the 5 skills each have exactly 5 descriptors
- `skillsCatalog.test.ts`: the 3 skills have the correct fault tags
- `evaluations.test.ts`: `GET /categories` response includes `descriptors` array on every skill

---

## PR 3 — Screen sections + stroke labels

Add collapsible section headers to the evaluation form (matching the section structure in the decisions doc), add stroke qualifiers to ambiguous skill names, and warn the coach when session date is today.

### Shared schema

**`packages/shared/src/schemas/evaluations.ts`** — `SkillForRatingSchema`:
- Add `stroke: StrokeSchema.nullable()` (required field; null when not stroke-specific)

### API — GET /categories

**`apps/api/src/routes/evaluations.ts`** (coachCategoriesRouter):
- Include `stroke` (from `skills.stroke`, nullable) in the skills response

### Web — screen section config

**`apps/web/src/content/EvaluateContent/screenSections.ts`** (new file):
- Export `SCREEN_SECTIONS: Record<string, Array<{ name: string; slugs: string[] }>>` mapping each category slug to its ordered sections.
- Section layouts per category (slugs listed in screen order):
  - `freestyle`: "The swim" + "Numbers"
  - `backstroke`: "The swim" + "Numbers"
  - `breaststroke`: "The swim" + "Numbers"
  - `butterfly`: "The swim" + "Numbers"
  - `body-position-balance`: "Fundamentals" (all active swimmer-level skills)
  - `breathing-coordination`: "Swimmer-level" + "Freestyle" + "Backstroke" + "Breaststroke" + "Butterfly"
  - `starts-turns-underwaters`: "Underwaters" + "Push-off & Streamline" + "Breakouts" + "Starts" + "Turns"
  - `racing-performance`: "Racing" (all skills, one section)
  - `water-confidence`: "Water Confidence" (all skills, one section)
- Skills not listed in any section (newly added or removed since the config was last updated) fall into an implicit "Other" section rendered at the bottom.

### Web — helpers

**`apps/web/src/content/EvaluateContent/helpers.ts`**:
- Add `buildSectionGroups(category, sections)`: returns an array of `{ name: string; skills: SkillForRating[] }`. Skills are grouped by section slug membership; skills absent from every section slug list collect in a trailing "Other" group (omitted when empty).
- Add `skillDisplayLabel(skill: SkillForRating, allSkills: SkillForRating[]): string`: returns `skill.name` when the name is unique across `allSkills`, or `"${skill.name} · ${stroke}"` (capitalised stroke) when another skill shares the same name.

### Web — EvalSectionHeader component

**`apps/web/src/content/EvaluateContent/EvalSectionHeader.tsx`** (new file):
- Collapsible section header: shows section name + skill count; clicking toggles open/closed. Starts expanded.
- Follows the axiom-aquatics-design token system (no hardcoded colours).

### Web — EvaluateContent

**`apps/web/src/content/EvaluateContent/EvaluateContent.tsx`**:
- When `SCREEN_SECTIONS[selectedCategory.slug]` is defined, call `buildSectionGroups()` and render skills in collapsible sections using `EvalSectionHeader`.
- Apply `skillDisplayLabel()` as the `label` prop on every `SkillGradeRow`, `SideRatedRowPair`, and `CalculatedSkillRow`.
- Fall back to the existing flat `buildSkillGroups()` render when no section config exists for the category (defensive).

### Web — SessionSetup

**`apps/web/src/content/EvaluateContent/SessionSetup.tsx`**:
- If `draft.sessionDate === todayLA()`, render a small inline warning: _"Session date is today — change it if rating from memory."_

### Tests

- `evaluations.test.ts`: `GET /categories` response includes `stroke` on skills
- `helpers.test.ts` (new file or appended): `buildSectionGroups` groups correctly; `skillDisplayLabel` adds stroke suffix only for name collisions
