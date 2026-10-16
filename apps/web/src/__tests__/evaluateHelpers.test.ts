import { describe, it, expect } from "vitest";
import { mapSubmitResponse, buildSkillGroups } from "../content/EvaluateContent/helpers";
import type { SkillForRating } from "@swim-app/shared";

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

  const category = {
    id: "cat-1",
    slug: "freestyle",
    name: "Freestyle",
    sortOrder: 1,
    skills: [parent, child1, child2, standalone],
  };

  it("identifies the start parent (has children)", () => {
    const { startParents } = buildSkillGroups(category);
    expect(startParents).toHaveLength(1);
    expect(startParents[0]?.id).toBe("start-parent");
  });

  it("excludes start parent and its children from standalone skills", () => {
    const { standaloneSkills } = buildSkillGroups(category);
    expect(standaloneSkills).toHaveLength(1);
    expect(standaloneSkills[0]?.id).toBe("standalone");
  });

  it("componentSkillsOf returns children of the given parent", () => {
    const { componentSkillsOf } = buildSkillGroups(category);
    const children = componentSkillsOf("start-parent");
    expect(children.map((s) => s.id)).toEqual(["child-1", "child-2"]);
  });

  it("returns empty startParents when no skill has children", () => {
    const flat = { ...category, skills: [standalone] };
    const { startParents, standaloneSkills } = buildSkillGroups(flat);
    expect(startParents).toHaveLength(0);
    expect(standaloneSkills).toHaveLength(1);
  });
});
