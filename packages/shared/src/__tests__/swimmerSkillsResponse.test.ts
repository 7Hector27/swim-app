// Regression: the previous SwimmerSkillsResponseSchema expected
// coachingPriorities[*].chain[*] to be { slug, grade, sortOrder }, but the
// API handler has always emitted { slug, notAssessed } (its ChainEntry
// type). When a swimmer had NO ratings the chain was always empty and the
// parse was a false positive. The first rating that produced a non-empty
// chain made the parser fail and the evaluate page threw
// "Failed to load prior skills (status 500)".

import { describe, it, expect } from "vitest";
import {
  SwimmerSkillsResponseSchema,
  type SwimmerSkillsResponse,
} from "../schemas/evaluations";

describe("SwimmerSkillsResponseSchema", () => {
  it("accepts an empty response (swimmer with no ratings)", () => {
    const body: SwimmerSkillsResponse = {
      grades: {},
      startGrades: {},
      coachingPriorities: [],
    };
    const parsed = SwimmerSkillsResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("accepts a real handler response with chains of { slug, notAssessed }", () => {
    // Shape taken verbatim from GET /coach/swimmers/:id/skills in dev
    // against a swimmer with six low-rated fundamentals.
    const body = {
      grades: { "buoyancy-balance": 2, "core-stability": 1 },
      startGrades: {
        "track-start": {
          status: "in_progress" as const,
          missing: ["track-start-reaction"],
        },
      },
      headPositionOverall: null,
      coachingPriorities: [
        {
          targetSlug: "buoyancy-balance",
          chain: [
            { slug: "buoyancy-balance", notAssessed: false },
            { slug: "core-stability", notAssessed: false },
          ],
        },
      ],
    };
    const parsed = SwimmerSkillsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        "Expected parse to succeed. Issues: " + JSON.stringify(parsed.error.issues, null, 2),
      );
    }
    expect(parsed.data.coachingPriorities[0]?.chain[0]).toEqual({
      slug: "buoyancy-balance",
      notAssessed: false,
    });
  });

  it("rejects a chain entry missing notAssessed", () => {
    const body = {
      grades: {},
      startGrades: {},
      coachingPriorities: [
        {
          targetSlug: "buoyancy-balance",
          chain: [{ slug: "buoyancy-balance" }],
        },
      ],
    };
    const parsed = SwimmerSkillsResponseSchema.safeParse(body);
    expect(parsed.success).toBe(false);
  });
});
