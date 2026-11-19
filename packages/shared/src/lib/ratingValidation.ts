import type {
  CapacityUnit,
  GolfScoreCategory,
  MeasurementUnit,
  RatingSide,
} from "../schemas/evaluations";
import { displayUnitToMeasurementEnum } from "./measurementUnit";

// Shared per-rating cross-field validator. The create route
// (POST /coach/swimmers/:id/sessions) and the edit route
// (PATCH /coach/sessions/:id) both run the same seven checks against the
// skill catalog definition before touching the DB:
//
//   1. Rollup skills can't be rated directly (they're computed).
//   2. Score-type skills require golfScoreCategory (unless the rating is
//      noConcept); non-score skills must not carry one.
//   3. side is required when ratedPerSide and must be absent otherwise.
//   4. All submitted faultTags must appear in the skill's allowed list.
//   5. notLegal is only permitted on skills with notLegalAllowed = true.
//   6. measurementValue / measurementUnit are only permitted on measured
//      skills.
//   7. When the skill has a catalog unit, the submitted measurementUnit
//      must match it (mapped through displayUnitToMeasurementEnum).
//
// This file is the single source of truth. The two routes wrap the
// returned issue into their own Zod-style error path shape (CREATE uses
// `ratings[${index}].field`, PATCH uses `["ratings", index, "field"]`),
// but the predicate and message set are identical. Keeping it a pure
// function makes it testable without an HTTP mount and lets the create
// route and the edit route reject the same inputs by construction.

export interface RatingSkillDef {
  type: "rubric" | "measured" | "score" | "composite" | "rollup";
  ratedPerSide: boolean;
  notLegalAllowed: boolean;
  // Catalog display label (e.g. "cycles/min"); null when the skill has no
  // measurement unit.
  unit: string | null;
  allowedFaultTags: readonly string[];
}

export interface RatingPayload {
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
  side: RatingSide | null;
  capacityValue: string | null;
  capacityUnit: CapacityUnit | null;
  measurementValue: string | null;
  measurementUnit: MeasurementUnit | null;
  golfScoreCategory: GolfScoreCategory | null;
  // Pass 2c: golf-score inputs — hundredths-of-a-second time and the
  // paired stroke count. Only allowed on `score` skills.
  timeSeconds: number | null;
  strokeCountValue: number | null;
  faultTags: readonly string[];
}

// A single issue — the first failing check. The field name is the schema
// property name; callers prepend their path prefix (e.g. ratings[i]).
export interface RatingValidationIssue {
  field:
    | "skillId"
    | "ratingId"
    | "golfScoreCategory"
    | "side"
    | "notLegal"
    | "faultTags"
    | "measurementValue"
    | "measurementUnit"
    | "timeSeconds"
    | "strokeCountValue";
  message: string;
}

export function validateRatingAgainstSkill(
  skill: RatingSkillDef,
  payload: RatingPayload,
  // The CREATE flow carries skillId on the body; the PATCH flow carries
  // ratingId. The rollup rejection reports under whichever identifier the
  // caller used so the error path points at a real body field. All other
  // checks report under the field they apply to and don't need this.
  identifierField: "skillId" | "ratingId" = "skillId",
): RatingValidationIssue | null {
  if (skill.type === "rollup") {
    return {
      field: identifierField,
      message: "Rollup skills are calculated and cannot be rated directly",
    };
  }

  // Score (golf) skills: if the coach set a 1-5 grade, the row must also
  // carry a category + time + stroke count. "No concept" opts out —
  // numbers aren't expected when the swimmer can't do it. Other measured
  // skills (tempo, kick rate, stroke count) still save with just a grade.
  if (skill.type === "score" && payload.grade !== null && !payload.noConcept) {
    if (payload.golfScoreCategory === null) {
      return {
        field: "golfScoreCategory",
        message: "Pick a test category before saving a golf score.",
      };
    }
    if (payload.timeSeconds === null || payload.strokeCountValue === null) {
      return {
        field: "timeSeconds",
        message: "Enter the time and stroke count for this golf score.",
      };
    }
  }
  if (skill.type !== "score" && payload.golfScoreCategory !== null) {
    return {
      field: "golfScoreCategory",
      message: "Golf score category only applies to score skills",
    };
  }

  if (skill.ratedPerSide && payload.side === null) {
    return { field: "side", message: "side is required for this skill" };
  }
  if (!skill.ratedPerSide && payload.side !== null) {
    return { field: "side", message: "side must be absent for this skill" };
  }

  for (const tag of payload.faultTags) {
    if (!skill.allowedFaultTags.includes(tag)) {
      return { field: "faultTags", message: `Invalid fault tag: ${tag}` };
    }
  }

  if (payload.notLegal && !skill.notLegalAllowed) {
    return { field: "notLegal", message: "Not legal is not allowed for this skill" };
  }

  if (
    (payload.measurementValue !== null || payload.measurementUnit !== null) &&
    skill.type !== "measured"
  ) {
    return {
      field: "measurementValue",
      message: "Measurements only allowed on measured skills",
    };
  }

  if (payload.measurementUnit !== null && skill.unit !== null) {
    const expectedEnum = displayUnitToMeasurementEnum(skill.unit);
    if (expectedEnum !== null && payload.measurementUnit !== expectedEnum) {
      return {
        field: "measurementUnit",
        message: `Measurement unit must be ${skill.unit}`,
      };
    }
  }

  // Golf-score inputs (Pass 2c): only allowed on score skills, and the two
  // numeric fields pair with each other. The category requirement and
  // paired-fields invariant are also enforced by Zod + DB check constraints;
  // the type gate is only enforceable here because it needs catalog context.
  if (
    (payload.timeSeconds !== null || payload.strokeCountValue !== null) &&
    skill.type !== "score"
  ) {
    return {
      field: "timeSeconds",
      message: "Golf-score time and stroke count only allowed on score skills",
    };
  }

  return null;
}
