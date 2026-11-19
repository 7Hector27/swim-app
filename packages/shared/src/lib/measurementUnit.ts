import type { MeasurementUnit } from "../schemas/evaluations";

// Maps a skill's catalog `unit` display label (free text like "cycles/min")
// to the `measurement_unit` DB enum value. The two columns were introduced
// for different purposes — `skills.unit` is a UI label; `skill_ratings.
// measurement_unit` is the stored enum — but the shape of a submitted
// rating has to pair a numeric `measurementValue` with a valid enum
// `measurementUnit` (DB-level NOT NULL = NOT NULL check). This mapping is
// the single source of truth for that correspondence; the client uses it
// to auto-fill the submit body, and the API uses it to validate a coach's
// chosen unit against the skill the rating is for.
//
// Returns `null` when the catalog label has no enum equivalent (e.g.
// "kicks/min"). Callers should treat that as "measurements can't be saved
// for this skill" and hide the entry.
//
// Keep this in sync with `skills.unit` labels in
// `apps/api/src/db/reference/skillsCatalog.ts`. When a new catalog label is
// added, either add a mapping here or add the label to
// INTENTIONALLY_UNMAPPED_CATALOG_UNITS below. The catalog-vs-mapping test
// in apps/api/src/__tests__/measurementUnitCatalog.test.ts fails if a
// catalog label is neither mapped nor explicitly listed as unmapped.
const CATALOG_TO_ENUM: Record<string, MeasurementUnit> = {
  "s": "seconds",
  "ft": "feet",
  "cycles/min": "stroke_cycles_per_minute",
  "strokes/length": "stroke_count",
  "kicks/min": "kicks_per_minute",
};

// Catalog unit labels that intentionally do not map to a measurement_unit
// enum. Golf-score skills record their raw numbers in time_seconds +
// stroke_count_value (plus golfScoreCategory), not measurement_value.
export const INTENTIONALLY_UNMAPPED_CATALOG_UNITS: ReadonlySet<string> = new Set([
  "time_s + stroke_count",
]);

export function displayUnitToMeasurementEnum(
  displayUnit: string | null,
): MeasurementUnit | null {
  if (displayUnit === null) return null;
  return CATALOG_TO_ENUM[displayUnit] ?? null;
}
