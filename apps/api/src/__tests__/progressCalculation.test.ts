import { vi, describe, it, expect, beforeEach } from "vitest";

const SWIMMER_ID  = "aaaa0000-0000-0000-0000-000000000001";
const SKILL_ID    = "bbbb0000-0000-0000-0000-000000000001";
const RATING_ID   = "cccc0000-0000-0000-0000-000000000001";
const CATEGORY_ID = "dddd0000-0000-0000-0000-000000000001";

const ratedAt = new Date("2025-06-01T10:00:00.000Z");

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

import { computeSwimmerProgress } from "../lib/progressCalculation";

const allRatingRows = [
  {
    slug: "freestyle-kick",
    grade: 3,
    notLegal: false,
    noConcept: false,
    side: null,
    ratedAt,
    voidedAt: null,
    skillId: SKILL_ID,
    sortOrder: 1,
  },
];

const allSkillRows = [
  {
    id: SKILL_ID,
    slug: "freestyle-kick",
    name: "Freestyle Kick",
    parentSkillId: null,
    categoryId: CATEGORY_ID,
    sortOrder: 1,
  },
];

const displayRatingRows = [
  {
    ratingId: RATING_ID,
    grade: 3,
    notLegal: false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    ratedAt,
    skillId: SKILL_ID,
    slug: "freestyle-kick",
    skillName: "Freestyle Kick",
    skillType: "rubric",
    skillUnit: null,
    ratedPerSide: false,
    sortOrder: 1,
    parentSkillId: null,
    categoryId: CATEGORY_ID,
    categoryName: "Freestyle",
    context: "practice",
    sessionDate: "2025-06-01",
  },
];

const faultTagRows = [
  { ratingId: RATING_ID, faultTag: "flat-kick" },
  { ratingId: RATING_ID, faultTag: "crossover" },
];

function allRatingsMock() {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(allRatingRows),
      }),
    }),
  };
}

function allSkillsMock() {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(allSkillRows),
    }),
  };
}

function depRowsMock() {
  return { from: vi.fn().mockResolvedValue([]) };
}

function displayRatingsMock() {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(displayRatingRows),
            }),
          }),
        }),
      }),
    }),
  };
}

function faultTagsMock() {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(faultTagRows),
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("computeSwimmerProgress — audience option", () => {
  it("coach audience fetches fault tags and includes them in history", async () => {
    mockDbSelect
      .mockReturnValueOnce(allRatingsMock())
      .mockReturnValueOnce(allSkillsMock())
      .mockReturnValueOnce(depRowsMock())
      .mockReturnValueOnce(displayRatingsMock())
      .mockReturnValueOnce(faultTagsMock()); // 5th call: fault tags

    const result = await computeSwimmerProgress(SWIMMER_ID, { audience: "coach" });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.history[0]!.faultTags).toEqual(["flat-kick", "crossover"]);
    expect(mockDbSelect).toHaveBeenCalledTimes(5);
  });

  it("parent audience skips the fault tag query and history points have no tags", async () => {
    mockDbSelect
      .mockReturnValueOnce(allRatingsMock())
      .mockReturnValueOnce(allSkillsMock())
      .mockReturnValueOnce(depRowsMock())
      .mockReturnValueOnce(displayRatingsMock());
    // Deliberately no 5th mock — the query must not be issued

    const result = await computeSwimmerProgress(SWIMMER_ID, { audience: "parent" });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.history[0]!.faultTags).toEqual([]);
    expect(mockDbSelect).toHaveBeenCalledTimes(4);
  });
});
