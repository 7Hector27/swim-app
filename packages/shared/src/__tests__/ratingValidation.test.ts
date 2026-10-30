import { describe, it, expect } from "vitest";
import {
  validateRatingAgainstSkill,
  type RatingPayload,
  type RatingSkillDef,
} from "../lib/ratingValidation";

function makeSkill(overrides: Partial<RatingSkillDef> = {}): RatingSkillDef {
  return {
    type: "rubric",
    ratedPerSide: false,
    notLegalAllowed: false,
    unit: null,
    allowedFaultTags: [],
    ...overrides,
  };
}

function makePayload(overrides: Partial<RatingPayload> = {}): RatingPayload {
  return {
    grade: 3,
    notLegal: false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    golfScoreCategory: null,
    faultTags: [],
    ...overrides,
  };
}

describe("validateRatingAgainstSkill", () => {
  it("returns null for a straightforward valid rubric rating", () => {
    expect(validateRatingAgainstSkill(makeSkill(), makePayload())).toBeNull();
  });

  it("rejects a rating against a rollup skill under the identifier field", () => {
    const skillIssue = validateRatingAgainstSkill(makeSkill({ type: "rollup" }), makePayload(), "skillId");
    expect(skillIssue).toEqual({ field: "skillId", message: expect.stringMatching(/rollup/i) });

    const ratingIssue = validateRatingAgainstSkill(makeSkill({ type: "rollup" }), makePayload(), "ratingId");
    expect(ratingIssue).toEqual({ field: "ratingId", message: expect.stringMatching(/rollup/i) });
  });

  describe("golfScoreCategory", () => {
    it("requires golfScoreCategory on score skills when noConcept is false", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "score" }),
        makePayload({ golfScoreCategory: null, noConcept: false }),
      );
      expect(issue).toEqual({
        field: "golfScoreCategory",
        message: expect.stringMatching(/required/i),
      });
    });

    it("accepts null golfScoreCategory on score skills when noConcept is true", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "score" }),
        makePayload({ golfScoreCategory: null, noConcept: true, grade: null }),
      );
      expect(issue).toBeNull();
    });

    it("rejects a golfScoreCategory on a non-score skill", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "rubric" }),
        makePayload({ golfScoreCategory: "block_dive" }),
      );
      expect(issue).toEqual({
        field: "golfScoreCategory",
        message: expect.stringMatching(/only applies to score/i),
      });
    });
  });

  describe("side", () => {
    it("requires side on a ratedPerSide skill", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ ratedPerSide: true }),
        makePayload({ side: null }),
      );
      expect(issue).toEqual({ field: "side", message: expect.stringMatching(/required/i) });
    });

    it("rejects side on a non-ratedPerSide skill", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ ratedPerSide: false }),
        makePayload({ side: "left" }),
      );
      expect(issue).toEqual({ field: "side", message: expect.stringMatching(/absent/i) });
    });
  });

  it("rejects a fault tag that isn't in the skill's allowed list", () => {
    const issue = validateRatingAgainstSkill(
      makeSkill({ allowedFaultTags: ["foo", "bar"] }),
      makePayload({ faultTags: ["baz"] }),
    );
    expect(issue).toEqual({ field: "faultTags", message: expect.stringContaining("baz") });
  });

  it("rejects notLegal on a skill that doesn't allow it", () => {
    const issue = validateRatingAgainstSkill(
      makeSkill({ notLegalAllowed: false }),
      makePayload({ notLegal: true }),
    );
    expect(issue).toEqual({ field: "notLegal", message: expect.stringMatching(/not allowed/i) });
  });

  describe("measurement", () => {
    it("rejects a measurement value on a non-measured skill", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "rubric" }),
        makePayload({ measurementValue: "12.3", measurementUnit: "seconds" }),
      );
      expect(issue).toEqual({
        field: "measurementValue",
        message: expect.stringMatching(/measured/i),
      });
    });

    it("rejects a measurementUnit that doesn't match the skill's catalog unit", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "measured", unit: "cycles/min" }),
        makePayload({ measurementValue: "72", measurementUnit: "seconds" }),
      );
      expect(issue).toEqual({
        field: "measurementUnit",
        message: expect.stringMatching(/cycles\/min/i),
      });
    });

    it("accepts a matching measurementUnit on a measured skill", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "measured", unit: "cycles/min" }),
        makePayload({ measurementValue: "72", measurementUnit: "stroke_cycles_per_minute" }),
      );
      expect(issue).toBeNull();
    });

    it("accepts a null measurement on a measured skill (not every rating takes a measurement)", () => {
      const issue = validateRatingAgainstSkill(
        makeSkill({ type: "measured", unit: "cycles/min" }),
        makePayload({ measurementValue: null, measurementUnit: null }),
      );
      expect(issue).toBeNull();
    });
  });

  // The same validator runs under both the CREATE path and the PATCH path.
  // Verifying that the identifier field is the only output difference nails
  // the "both routes reject the same inputs" invariant.
  it("CREATE and PATCH identifier-only difference: same predicate set", () => {
    const invalid = makePayload({ notLegal: true });
    const skillDef = makeSkill({ notLegalAllowed: false });

    const createIssue = validateRatingAgainstSkill(skillDef, invalid, "skillId");
    const patchIssue = validateRatingAgainstSkill(skillDef, invalid, "ratingId");

    // Both routes reject this input, with identical field + message for a
    // field-local rule (notLegal doesn't flip to the identifier field).
    expect(createIssue).toEqual(patchIssue);
    expect(createIssue?.field).toBe("notLegal");
  });
});
