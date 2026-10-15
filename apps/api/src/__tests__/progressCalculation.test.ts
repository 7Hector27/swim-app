import { vi, describe, it, expect, beforeEach } from "vitest";

const SWIMMER_ID           = "aaaa0000-0000-0000-0000-000000000001";
const SKILL_ID             = "bbbb0000-0000-0000-0000-000000000001";
const RATING_ID            = "cccc0000-0000-0000-0000-000000000001";
const CATEGORY_ID          = "dddd0000-0000-0000-0000-000000000001";
const BILATERAL_SKILL_ID   = "eeee0000-0000-0000-0000-000000000001";
const BREATHING_SKILL_ID   = "ffff0000-0000-0000-0000-000000000001";
const BILATERAL_LEFT_ID    = "1111aaaa-0000-0000-0000-000000000001";
const BILATERAL_RIGHT_ID   = "2222aaaa-0000-0000-0000-000000000001";

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
    categoryName: "Freestyle",
    sortOrder: 1,
  },
];

const allSkillRowsWithBilateral = [
  ...allSkillRows,
  {
    id: BILATERAL_SKILL_ID,
    slug: "free-bilateral-breathing",
    name: "Bilateral Breathing",
    parentSkillId: null,
    categoryId: CATEGORY_ID,
    categoryName: "Freestyle",
    sortOrder: 5,
  },
  {
    id: BREATHING_SKILL_ID,
    slug: "breathing-timing-free",
    name: "Breathing Timing Free",
    parentSkillId: null,
    categoryId: CATEGORY_ID,
    categoryName: "Freestyle",
    sortOrder: 4,
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

function allSkillsMock(rows = allSkillRows) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

// Rating rows for a swimmer who has both sides of breathing-timing-free graded
const bilateralRatingRows = [
  {
    slug: "breathing-timing-free",
    grade: 3,
    notLegal: false,
    noConcept: false,
    side: "left",
    ratedAt,
    voidedAt: null,
    skillId: BREATHING_SKILL_ID,
    sortOrder: 4,
  },
  {
    slug: "breathing-timing-free",
    grade: 4,
    notLegal: false,
    noConcept: false,
    side: "right",
    ratedAt,
    voidedAt: null,
    skillId: BREATHING_SKILL_ID,
    sortOrder: 4,
  },
];

const bilateralDisplayRows = [
  {
    ratingId: BILATERAL_LEFT_ID,
    grade: 3,
    notLegal: false,
    noConcept: false,
    side: "left",
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    ratedAt,
    skillId: BREATHING_SKILL_ID,
    slug: "breathing-timing-free",
    skillName: "Breathing Timing Free",
    skillType: "rubric",
    skillUnit: null,
    ratedPerSide: true,
    sortOrder: 4,
    parentSkillId: null,
    categoryId: CATEGORY_ID,
    categoryName: "Freestyle",
    context: "practice",
    sessionDate: "2025-06-01",
  },
  {
    ratingId: BILATERAL_RIGHT_ID,
    grade: 4,
    notLegal: false,
    noConcept: false,
    side: "right",
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    ratedAt,
    skillId: BREATHING_SKILL_ID,
    slug: "breathing-timing-free",
    skillName: "Breathing Timing Free",
    skillType: "rubric",
    skillUnit: null,
    ratedPerSide: true,
    sortOrder: 4,
    parentSkillId: null,
    categoryId: CATEGORY_ID,
    categoryName: "Freestyle",
    context: "practice",
    sessionDate: "2025-06-01",
  },
];

function bilateralAllRatingsMock() {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(bilateralRatingRows),
      }),
    }),
  };
}

function bilateralDisplayMock() {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(bilateralDisplayRows),
            }),
          }),
        }),
      }),
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

describe("computeSwimmerProgress — bilateral breathing rollup", () => {
  it("injects free-bilateral-breathing entry (grade = weaker side) when both sides rated", async () => {
    mockDbSelect
      .mockReturnValueOnce(bilateralAllRatingsMock())
      .mockReturnValueOnce(allSkillsMock(allSkillRowsWithBilateral))
      .mockReturnValueOnce(depRowsMock())
      .mockReturnValueOnce(bilateralDisplayMock());
    // No fault-tag mock needed — display rows have ratingIds but faultTagsMock not set up;
    // the SELECT will be issued but returns [] from the default mock (already reset).

    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await computeSwimmerProgress(SWIMMER_ID, { audience: "coach" });

    const bilateral = result.skills.find((s) => s.slug === "free-bilateral-breathing");
    expect(bilateral).toBeDefined();
    // Grade is weaker side: min(3, 4) = 3
    expect(bilateral?.current?.grade).toBe(3);
    expect(bilateral?.ratedPerSide).toBe(false);
    expect(bilateral?.history).toHaveLength(0);
  });

  it("does not inject free-bilateral-breathing entry when only one side is rated", async () => {
    const oneRatingRow = [bilateralRatingRows[0]!]; // left only, grade 3
    const oneDisplayRow = [bilateralDisplayRows[0]!];

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(oneRatingRow),
          }),
        }),
      })
      .mockReturnValueOnce(allSkillsMock(allSkillRowsWithBilateral))
      .mockReturnValueOnce(depRowsMock())
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue(oneDisplayRow),
                }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const result = await computeSwimmerProgress(SWIMMER_ID, { audience: "coach" });

    const bilateral = result.skills.find((s) => s.slug === "free-bilateral-breathing");
    expect(bilateral).toBeUndefined();
  });
});
