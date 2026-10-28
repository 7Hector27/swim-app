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
const CATALOG_TO_ENUM: Record<string, MeasurementUnit> = {
  "s": "seconds",
  "ft": "feet",
  "cycles/min": "stroke_cycles_per_minute",
  "strokes/length": "stroke_count",
};

export function displayUnitToMeasurementEnum(
  displayUnit: string | null,
): MeasurementUnit | null {
  if (displayUnit === null) return null;
  return CATALOG_TO_ENUM[displayUnit] ?? null;
}
