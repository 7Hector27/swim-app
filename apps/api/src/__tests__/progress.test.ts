import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000003";
const SKILL_ID = "eeeeeeee-0000-0000-0000-000000000005";
const CATEGORY_ID = "dddddddd-0000-0000-0000-000000000004";

const now = new Date("2025-06-01T10:00:00.000Z");

const { mockGetUser, mockDbSelect } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
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

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const profileCoach = {
  id: COACH_ID,
  role: "coach" as const,
  fullName: "Coach Jason",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const profileParent = {
  id: PARENT_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const activeSwimmerRow = { id: SWIMMER_ID, archivedAt: null };

type AnyProfile = { id: string; role: string; [key: string]: unknown };

function authAs(profile: AnyProfile) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: profile.id, email: "user@example.com" } },
    error: null,
  });
}

function requireUserSelect(profile: AnyProfile) {
  const where = vi.fn().mockResolvedValue([profile]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function swimmerSelect(row: typeof activeSwimmerRow | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// Helper: set up the full mock sequence for GET /progress happy path
function setupProgressMocks() {
  const allRatingRows = [
    {
      slug: "freestyle-kick",
      grade: 3,
      notLegal: false,
      noConcept: false,
      side: null,
      ratedAt: now,
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
      ratingId: "ratingid1-0000-0000-0000-000000000001",
      grade: 3,
      notLegal: false,
      noConcept: false,
      side: null,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
      ratedAt: now,
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

  mockDbSelect
    .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
    .mockReturnValueOnce(swimmerSelect(activeSwimmerRow)) // findActiveSwimmer
    .mockReturnValueOnce({                               // allRatingRows
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(allRatingRows),
        }),
      }),
    })
    .mockReturnValueOnce({                               // allSkillRows
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(allSkillRows),
        }),
      }),
    })
    .mockReturnValueOnce({                               // depRows
      from: vi.fn().mockResolvedValue([]),
    })
    .mockReturnValueOnce({                               // displayRatingRows
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
    })
    .mockReturnValueOnce({                               // fault tags
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
}

describe("GET /coach/swimmers/:id/progress", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/coach/swimmers/${SWIMMER_ID}/progress`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for parent role", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 404 when swimmer not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerSelect(null));
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 200 with skill progress for coach", async () => {
    authAs(profileCoach);
    setupProgressMocks();
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("skills");
    expect(res.body).toHaveProperty("startProgress");
    expect(res.body).toHaveProperty("coachingPriorities");
    expect(Array.isArray(res.body.skills)).toBe(true);
  });

  it("shows both sides for side-rated skills", async () => {
    authAs(profileCoach);

    const SIDED_SKILL_ID = "sidedskl-0000-0000-0000-000000000001";

    const allRatingRows = [
      {
        slug: "freestyle-breathing",
        grade: 3,
        notLegal: false,
        noConcept: false,
        side: "left",
        ratedAt: now,
        voidedAt: null,
        skillId: SIDED_SKILL_ID,
        sortOrder: 2,
      },
      {
        slug: "freestyle-breathing",
        grade: 4,
        notLegal: false,
        noConcept: false,
        side: "right",
        ratedAt: now,
        voidedAt: null,
        skillId: SIDED_SKILL_ID,
        sortOrder: 2,
      },
    ];

    const displayRatingRows = [
      {
        ratingId: "ratingid2-0000-0000-0000-000000000001",
        grade: 3,
        notLegal: false,
        noConcept: false,
        side: "left",
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        ratedAt: now,
        skillId: SIDED_SKILL_ID,
        slug: "freestyle-breathing",
        skillName: "Freestyle Breathing",
        skillType: "rubric",
        skillUnit: null,
        ratedPerSide: true,
        sortOrder: 2,
        parentSkillId: null,
        categoryId: CATEGORY_ID,
        categoryName: "Freestyle",
        context: "practice",
        sessionDate: "2025-06-01",
      },
      {
        ratingId: "ratingid3-0000-0000-0000-000000000001",
        grade: 4,
        notLegal: false,
        noConcept: false,
        side: "right",
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        ratedAt: now,
        skillId: SIDED_SKILL_ID,
        slug: "freestyle-breathing",
        skillName: "Freestyle Breathing",
        skillType: "rubric",
        skillUnit: null,
        ratedPerSide: true,
        sortOrder: 2,
        parentSkillId: null,
        categoryId: CATEGORY_ID,
        categoryName: "Freestyle",
        context: "practice",
        sessionDate: "2025-06-01",
      },
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(allRatingRows),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({
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
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    const skill = res.body.skills[0];
    expect(skill.ratedPerSide).toBe(true);
    expect(skill.currentLeft).not.toBeNull();
    expect(skill.currentLeft.grade).toBe(3);
    expect(skill.currentRight).not.toBeNull();
    expect(skill.currentRight.grade).toBe(4);
  });

  it("includes start grades", async () => {
    authAs(profileCoach);

    const START_PARENT_ID = "startpar-0000-0000-0000-000000000001";
    const COMP1_ID = "compone1-0000-0000-0000-000000000001";

    const allSkillRows = [
      { id: START_PARENT_ID, slug: "track-start", name: "Track Start", parentSkillId: null, categoryId: CATEGORY_ID, sortOrder: 10 },
      { id: COMP1_ID, slug: "reaction-time", name: "Reaction Time", parentSkillId: START_PARENT_ID, categoryId: CATEGORY_ID, sortOrder: 11 },
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(allSkillRows),
          }),
        }),
      })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.startProgress).toHaveLength(1);
    expect(res.body.startProgress[0].slug).toBe("track-start");
    expect(res.body.startProgress[0].grade.status).toBe("in_progress");
  });

  it("resolves chain skill names in coaching priorities", async () => {
    authAs(profileCoach);

    const SKILL_A_ID = "skillaid-0000-0000-0000-000000000001";
    const SKILL_B_ID = "skillbid-0000-0000-0000-000000000001";

    const allRatingRows = [
      {
        slug: "skill-a",
        grade: 1,
        notLegal: false,
        noConcept: false,
        side: null,
        ratedAt: now,
        voidedAt: null,
        skillId: SKILL_A_ID,
        sortOrder: 1,
      },
    ];

    const allSkillRows = [
      { id: SKILL_A_ID, slug: "skill-a", name: "Skill A", parentSkillId: null, categoryId: CATEGORY_ID, sortOrder: 1 },
      { id: SKILL_B_ID, slug: "skill-b", name: "Skill B", parentSkillId: null, categoryId: CATEGORY_ID, sortOrder: 2 },
    ];

    const depRows = [{ skillId: SKILL_A_ID, dependsOnSkillId: SKILL_B_ID }];

    const displayRatingRows = [
      {
        ratingId: "ratingid4-0000-0000-0000-000000000001",
        grade: 1,
        notLegal: false,
        noConcept: false,
        side: null,
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        ratedAt: now,
        skillId: SKILL_A_ID,
        slug: "skill-a",
        skillName: "Skill A",
        skillType: "rubric",
        skillUnit: null,
        ratedPerSide: false,
        sortOrder: 1,
        parentSkillId: null,
        categoryId: CATEGORY_ID,
        categoryName: "Test",
        context: "practice",
        sessionDate: "2025-06-01",
      },
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(allRatingRows),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(allSkillRows),
          }),
        }),
      })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue(depRows) })
      .mockReturnValueOnce({
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
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.coachingPriorities.length).toBeGreaterThan(0);
    const priority = res.body.coachingPriorities[0];
    expect(priority.targetName).toBe("Skill A");
    const chainEntry = priority.chain[priority.chain.length - 1];
    expect(chainEntry.name).toBe("Skill B");
  });

  it("includes fault tags on history entries", async () => {
    authAs(profileCoach);

    const RATING_ID = "ratingft-0000-0000-0000-000000000001";

    const displayRatingRows = [
      {
        ratingId: RATING_ID,
        grade: 2,
        notLegal: false,
        noConcept: false,
        side: null,
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        ratedAt: now,
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
      { ratingId: RATING_ID, faultTag: "head-up" },
      { ratingId: RATING_ID, faultTag: "wide-kick" },
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce({                               // allRatingRows
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              {
                slug: "freestyle-kick",
                grade: 2,
                notLegal: false,
                noConcept: false,
                side: null,
                ratedAt: now,
                voidedAt: null,
                skillId: SKILL_ID,
                sortOrder: 1,
              },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({                               // allSkillRows
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: SKILL_ID, slug: "freestyle-kick", name: "Freestyle Kick", parentSkillId: null, categoryId: CATEGORY_ID, categoryName: "Freestyle", sortOrder: 1 },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }) // depRows
      .mockReturnValueOnce({                               // displayRatingRows
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
      })
      .mockReturnValueOnce({                               // fault tags
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(faultTagRows),
        }),
      });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    const skill = res.body.skills[0];
    expect(skill.history[0].faultTags).toEqual(["head-up", "wide-kick"]);
  });
});
