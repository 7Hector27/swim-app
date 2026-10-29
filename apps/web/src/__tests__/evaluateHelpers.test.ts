import { describe, it, expect } from "vitest";
import {
  mapSubmitResponse,
  mapZodIssuesToFieldIssues,
  buildSkillGroups,
  buildSectionGroups,
  buildRatingsArray,
  validateSubmission,
  sortIssuesForScroll,
  anchorIdForIssue,
  DOM_IDS,
  initialSessionDraft,
  defaultSkillDraft,
} from "../content/EvaluateContent/helpers";
import type { SkillForRating } from "@swim-app/shared";
import { CreateSessionBodySchema } from "@swim-app/shared";

describe("mapSubmitResponse", () => {
  it("returns saved state on 201 with valid body", () => {
    const body = {
      sessionId: "00000000-0000-0000-0000-000000000001",
      ratingIds: ["00000000-0000-0000-0000-000000000002"],
    };
    expect(mapSubmitResponse(201, body)).toEqual({
      status: "saved",
      sessionId: body.sessionId,
      ratingIds: body.ratingIds,
    });
  });

  it("returns saved state on 201 with empty ratingIds", () => {
    const body = { sessionId: "00000000-0000-0000-0000-000000000001", ratingIds: [] };
    expect(mapSubmitResponse(201, body)).toEqual({
      status: "saved",
      sessionId: body.sessionId,
      ratingIds: [],
    });
  });

  it("returns error on 201 with missing ratingIds", () => {
    const result = mapSubmitResponse(201, { sessionId: "abc" });
    expect(result.status).toBe("error");
  });

  it("returns error on 201 with missing sessionId", () => {
    const result = mapSubmitResponse(201, { ratingIds: [] });
    expect(result.status).toBe("error");
  });

  it("returns error on 201 when ratingIds contains non-string", () => {
    const result = mapSubmitResponse(201, { sessionId: "abc", ratingIds: [123] });
    expect(result.status).toBe("error");
  });

  it("returns error on 422", () => {
    const result = mapSubmitResponse(422, null);
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("invalid");
  });

  it("returns error on 404", () => {
    const result = mapSubmitResponse(404, null);
    expect(result.status).toBe("error");
  });

  it("returns error on 500", () => {
    const result = mapSubmitResponse(500, null);
    expect(result.status).toBe("error");
  });

  it("returns error on null body with 201", () => {
    const result = mapSubmitResponse(201, null);
    expect(result.status).toBe("error");
  });
});

// ── buildSkillGroups ──────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillForRating> & { id: string }): SkillForRating {
  return {
    slug: overrides.id,
    name: overrides.id,
    type: "rubric",
    unit: null,
    stroke: null,
    ratedPerSide: false,
    parentSkillId: null,
    sortOrder: 0,
    faultTags: [],
    descriptors: [],
    ...overrides,
    notLegalAllowed: overrides.notLegalAllowed ?? false,
  };
}

describe("buildSkillGroups", () => {
  const parent = makeSkill({ id: "start-parent", type: "composite" });
  const child1 = makeSkill({ id: "child-1", parentSkillId: "start-parent" });
  const child2 = makeSkill({ id: "child-2", parentSkillId: "start-parent" });
  const standalone = makeSkill({ id: "standalone" });

  const screen = {
    screenSlug: "freestyle",
    name: "Freestyle",
    skills: [parent, child1, child2, standalone],
  };

  it("identifies the start parent (has children)", () => {
    const { startParents } = buildSkillGroups(screen);
    expect(startParents).toHaveLength(1);
    expect(startParents[0]?.id).toBe("start-parent");
  });

  it("excludes start parent and its children from standalone skills", () => {
    const { standaloneSkills } = buildSkillGroups(screen);
    expect(standaloneSkills).toHaveLength(1);
    expect(standaloneSkills[0]?.id).toBe("standalone");
  });

  it("componentSkillsOf returns children of the given parent", () => {
    const { componentSkillsOf } = buildSkillGroups(screen);
    const children = componentSkillsOf("start-parent");
    expect(children.map((s) => s.id)).toEqual(["child-1", "child-2"]);
  });

  it("returns empty startParents when no skill has children", () => {
    const flat = { ...screen, skills: [standalone] };
    const { startParents, standaloneSkills } = buildSkillGroups(flat);
    expect(startParents).toHaveLength(0);
    expect(standaloneSkills).toHaveLength(1);
  });
});

// ── buildSectionGroups ────────────────────────────────────────────────────────

describe("buildSectionGroups", () => {
  const skillA = makeSkill({ id: "skill-a", slug: "slug-a", name: "Skill A" });
  const skillB = makeSkill({ id: "skill-b", slug: "slug-b", name: "Skill B" });
  const skillC = makeSkill({ id: "skill-c", slug: "slug-c", name: "Skill C" });
  const skillD = makeSkill({ id: "skill-d", slug: "slug-d", name: "Skill D" });

  const screen = {
    screenSlug: "freestyle",
    name: "Freestyle",
    skills: [skillA, skillB, skillC, skillD],
  };

  const sections = [
    { name: "Section 1", slugs: ["slug-a", "slug-b"] },
    { name: "Section 2", slugs: ["slug-c", "slug-d"] },
  ];

  it("produces 2 sections when all skills are assigned", () => {
    const result = buildSectionGroups(screen, sections);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("Section 1");
    expect(result[0]?.skills.map((s) => s.id)).toEqual(["skill-a", "skill-b"]);
    expect(result[1]?.name).toBe("Section 2");
    expect(result[1]?.skills.map((s) => s.id)).toEqual(["skill-c", "skill-d"]);
  });

  it("adds an Other section for unassigned skills", () => {
    const skillE = makeSkill({ id: "skill-e", slug: "slug-e", name: "Skill E" });
    const screenWithExtra = { ...screen, skills: [...screen.skills, skillE] };
    const result = buildSectionGroups(screenWithExtra, sections);
    expect(result).toHaveLength(3);
    const other = result[2];
    expect(other?.name).toBe("Other");
    expect(other?.skills.map((s) => s.id)).toEqual(["skill-e"]);
  });

  it("skips empty sections (slugs not matched)", () => {
    const partialSections = [
      { name: "Section 1", slugs: ["slug-a", "slug-b"] },
      { name: "Empty Section", slugs: ["not-a-slug"] },
    ];
    const result = buildSectionGroups(screen, partialSections);
    const sectionNames = result.map((s) => s.name);
    expect(sectionNames).not.toContain("Empty Section");
  });
});

// ── screenSections coverage ───────────────────────────────────────────────────

import { SCREEN_SLUGS } from "@swim-app/shared";
import { SCREEN_SECTIONS } from "../content/EvaluateContent/screenSections";

describe("SCREEN_SECTIONS", () => {
  it("every screen slug has a section layout", () => {
    for (const slug of SCREEN_SLUGS) {
      expect(SCREEN_SECTIONS[slug], `${slug} missing from SCREEN_SECTIONS`).toBeDefined();
    }
  });
});

// ── Measurement-unit regression ───────────────────────────────────────────────
//
// Previously: when a coach rated a freestyle measured skill (e.g. Tempo
// `unit: "cycles/min"`) and typed a measurement value, `buildRatingsArray`
// emitted `measurementValue: "60", measurementUnit: null`. The shared
// `CreateSessionBodySchema` superRefine then rejected with
// `ratings[0].measurementValue` — "both must be present or both absent".
// The server action surfaced only the generic
// "Some inputs are invalid. Please check and retry." with no field path.

describe("buildRatingsArray — measured skill with catalog unit", () => {
  const SKILL_ID = "00000000-0000-0000-0000-00000000e001";
  const measuredSkill: SkillForRating = {
    id: SKILL_ID,
    slug: "freestyle-tempo",
    name: "Tempo",
    type: "measured",
    unit: "cycles/min",
    stroke: "free",
    ratedPerSide: false,
    parentSkillId: null,
    sortOrder: 0,
    faultTags: [],
    notLegalAllowed: false,
    descriptors: [],
  };

  function baseSkillDraft() {
    return {
      grade: 3 as const,
      notLegal: false,
      noConcept: false,
      capacityValue: "",
      capacityUnit: null,
      measurementValue: "",
      measurementUnit: null,
      note: "",
      faultTags: [],
      detailsOpen: false,
      golfScoreCategory: null,
    };
  }

  it("auto-fills measurementUnit from the catalog label so safeParse passes", () => {
    const ratings = buildRatingsArray([measuredSkill], {
      [SKILL_ID]: { ...baseSkillDraft(), measurementValue: "60" },
    });
    expect(ratings).toHaveLength(1);
    expect(ratings[0]!.measurementValue).toBe("60");
    expect(ratings[0]!.measurementUnit).toBe("stroke_cycles_per_minute");
  });

  it("leaves both measurement fields null when the coach didn't enter a value", () => {
    const ratings = buildRatingsArray([measuredSkill], {
      [SKILL_ID]: { ...baseSkillDraft() },
    });
    expect(ratings[0]!.measurementValue).toBeNull();
    expect(ratings[0]!.measurementUnit).toBeNull();
  });

  it("produces a body that CreateSessionBodySchema accepts (regression)", () => {
    const ratings = buildRatingsArray([measuredSkill], {
      [SKILL_ID]: { ...baseSkillDraft(), measurementValue: "60" },
    });
    const body = {
      screenSlug: "freestyle",
      sessionDate: "2026-10-28",
      context: "practice" as const,
      coachingPriority: "Work on tempo",
      breathingPattern: "every_3" as const,
      ratings,
    };
    const parsed = CreateSessionBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("still rejects (and reports the right field) when the catalog unit has no enum map", () => {
    // "kicks/min" has no enum equivalent — the UI hides the measurement input
    // for this case, so coaches can't reach the failing state. But if a stale
    // draft or an older client ever submits `measurementValue` for such a
    // skill, the schema's rejection surfaces the per-row field path.
    const kickSkill: SkillForRating = { ...measuredSkill, slug: "freestyle-kick-rate", unit: "kicks/min" };
    const ratings = buildRatingsArray([kickSkill], {
      [SKILL_ID]: { ...baseSkillDraft(), measurementValue: "30" },
    });
    const parsed = CreateSessionBodySchema.safeParse({
      screenSlug: "freestyle",
      sessionDate: "2026-10-28",
      context: "practice" as const,
      coachingPriority: "p",
      breathingPattern: "every_3" as const,
      ratings,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = mapZodIssuesToFieldIssues(parsed.error.issues);
    const measurementIssue = issues.find(
      (issue) => issue.ratingIndex === 0 && issue.field === "measurementValue",
    );
    expect(measurementIssue).toBeDefined();
    expect(measurementIssue?.message).toMatch(/unit/i);
  });
});

describe("mapZodIssuesToFieldIssues", () => {
  it("extracts the rating index and field from a Zod path", () => {
    const result = mapZodIssuesToFieldIssues([
      { path: ["ratings", 2, "measurementValue"], message: "raw" },
      { path: ["coachingPriority"], message: "raw too" },
    ]);
    expect(result).toEqual([
      {
        ratingIndex: 2,
        field: "measurementValue",
        message: expect.stringMatching(/unit/i),
      },
      {
        field: "coachingPriority",
        message: expect.stringMatching(/coaching priority/i),
      },
    ]);
  });
});

describe("mapSubmitResponse — 422 with issues[]", () => {
  it("parses an API 422 body into per-field issues", () => {
    const result = mapSubmitResponse(422, {
      error: "Validation error",
      issues: [
        { path: ["ratings", 0, "measurementUnit"], message: "Measurement unit must be cycles/min" },
      ],
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.issues).toBeDefined();
    expect(result.issues?.[0]).toEqual({
      ratingIndex: 0,
      field: "measurementUnit",
      message: "Measurement unit must be cycles/min",
    });
  });
});

// ── validateSubmission ────────────────────────────────────────────────────────

describe("validateSubmission", () => {
  const SKILL: SkillForRating = {
    id: "00000000-0000-0000-cccc-000000000001",
    slug: "free-kick",
    name: "Kick",
    type: "rubric",
    unit: null,
    stroke: "free",
    ratedPerSide: false,
    notLegalAllowed: false,
    parentSkillId: null,
    sortOrder: 1,
    faultTags: [],
    descriptors: [],
  };

  function filledDraft() {
    return {
      ...initialSessionDraft(),
      screenSlug: "freestyle",
      sessionDate: "2026-10-28",
      context: "practice" as const,
      coachingPriority: "Work on kick",
      breathingPattern: "every_3" as const,
      skills: { [SKILL.id]: { ...defaultSkillDraft(), grade: 3 as const } },
    };
  }

  it("reports a specific per-field issue for each missing session field", () => {
    const draft = {
      ...initialSessionDraft(),
      screenSlug: "freestyle",
      sessionDate: "",
      context: null,
      coachingPriority: "   ",
      breathingPattern: null,
      skills: {},
    };
    const issues = validateSubmission(draft, []);
    const fields = issues.map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining([
      "sessionDate",
      "context",
      "breathingPattern",
      "ratings",
    ]));
    expect(fields).not.toContain("screenSlug"); // screen is picked
    // Coaching priority is optional. The parent progress view falls back to
    // the most recent non-empty priority from a non-voided session.
    expect(fields).not.toContain("coachingPriority");
  });

  it("allows saving with an empty coaching priority", () => {
    const SKILL: SkillForRating = {
      id: "00000000-0000-0000-cccc-00000000c003",
      slug: "free-kick",
      name: "Kick",
      type: "rubric",
      unit: null,
      stroke: "free",
      ratedPerSide: false,
      notLegalAllowed: false,
      parentSkillId: null,
      sortOrder: 1,
      faultTags: [],
      descriptors: [],
    };
    const draft = {
      ...initialSessionDraft(),
      screenSlug: "backstroke",
      sessionDate: "2026-10-28",
      context: "practice" as const,
      coachingPriority: "", // empty on purpose
      skills: { [SKILL.id]: { ...defaultSkillDraft(), grade: 3 as const } },
    };
    const ratings = buildRatingsArray([SKILL], draft.skills);
    expect(validateSubmission(draft, ratings)).toEqual([]);
  });

  it("does not require breathingPattern for backstroke", () => {
    const draft = {
      ...initialSessionDraft(),
      screenSlug: "backstroke",
      sessionDate: "2026-10-28",
      context: "practice" as const,
      coachingPriority: "Fix pull",
      skills: { [SKILL.id]: { ...defaultSkillDraft(), grade: 3 as const } },
    };
    const ratings = buildRatingsArray([SKILL], draft.skills);
    const issues = validateSubmission(draft, ratings);
    expect(issues.map((issue) => issue.field)).not.toContain("breathingPattern");
  });

  it("returns zero issues for a fully filled, schema-valid submission", () => {
    const draft = filledDraft();
    const ratings = buildRatingsArray([SKILL], draft.skills);
    expect(validateSubmission(draft, ratings)).toEqual([]);
  });

  it("still surfaces per-rating issues (measurement without a unit) via the schema", () => {
    const kickSkill: SkillForRating = {
      ...SKILL,
      id: "00000000-0000-0000-cccc-000000000002",
      slug: "free-kick-rate",
      type: "measured",
      unit: "kicks/min", // no enum mapping; triggers the "both or neither" check
    };
    const draft = {
      ...filledDraft(),
      skills: {
        [kickSkill.id]: { ...defaultSkillDraft(), grade: 3 as const, measurementValue: "30" },
      },
    };
    const ratings = buildRatingsArray([kickSkill], draft.skills);
    const issues = validateSubmission(draft, ratings);
    const measurementIssue = issues.find(
      (issue) => issue.ratingIndex === 0 && issue.field === "measurementValue",
    );
    expect(measurementIssue).toBeDefined();
  });
});

// ── sortIssuesForScroll + anchorIdForIssue ────────────────────────────────────

describe("sortIssuesForScroll", () => {
  it("puts session fields in canonical order, ratings next, coachingPriority last", () => {
    const issues = [
      { field: "coachingPriority", message: "" },
      { ratingIndex: 1, field: "grade", message: "" },
      { ratingIndex: 0, field: "grade", message: "" },
      { field: "sessionDate", message: "" },
      { field: "screenSlug", message: "" },
      { field: "context", message: "" },
    ];
    const sorted = sortIssuesForScroll(issues);
    const order = sorted.map((i) =>
      i.ratingIndex !== undefined ? `ratings[${i.ratingIndex}].${i.field}` : i.field,
    );
    expect(order).toEqual([
      "screenSlug",
      "sessionDate",
      "context",
      "ratings[0].grade",
      "ratings[1].grade",
      "coachingPriority",
    ]);
  });
});

describe("anchorIdForIssue", () => {
  it("maps session fields to DOM_IDS entries", () => {
    expect(anchorIdForIssue({ field: "screenSlug", message: "" }, [])).toBe(DOM_IDS.screenSlug);
    expect(anchorIdForIssue({ field: "coachingPriority", message: "" }, [])).toBe(DOM_IDS.coachingPriority);
  });

  it("maps rating issues to the skill fieldset id via the ratingKeys array", () => {
    expect(
      anchorIdForIssue({ ratingIndex: 1, field: "grade", message: "" }, ["skill-a", "skill-b"]),
    ).toBe("skill-skill-b");
  });

  it("returns null for an unknown field", () => {
    expect(anchorIdForIssue({ field: "nonsense", message: "" }, [])).toBeNull();
  });
});

