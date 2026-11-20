// Guard test: progress pages must never render a hardcoded third-person
// pronoun for a swimmer. The app doesn't store pronouns and guessing
// wrong is insulting — copy should use the swimmer's first name or a
// neutral phrase instead. This test renders both the parent and the
// coach progress pages against the same swimmer fixture (first name
// "Lennox", which doesn't itself contain any pronoun) and fails if any
// standalone "she/her/he/his/him" word turns up in the DOM text.
//
// If a new hardcoded pronoun slips in, the fix is almost always one of:
//   - interpolate `${swimmer.firstName}` into the string, or
//   - rewrite the sentence in a name-and-fact style ("Rotate the hips"
//     instead of "She rotates the hips").

import { describe, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type {
  CategoriesResponse,
  CoachSwimmerDetail,
  GolfScoreTrendsResponse,
  ParentCategoriesResponse,
  ParentGolfScoreTrendsResponse,
  ParentScoreHistoryResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ScoreHistoryResponse,
  SwimmerProgressResponse,
} from "@swim-app/shared";

vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/LevelLadder", () => ({ default: () => null }));

import ParentSwimmerProgressContent from "../content/ParentSwimmerProgressContent/ParentSwimmerProgressContent";
import SwimmerProgressContent from "../content/SwimmerProgressContent/SwimmerProgressContent";

// Match the full-word boundary — "shelf", "hero", "hers", "heads", and
// "hint" all contain the substrings "she"/"her"/"he"/"hi" without being
// pronouns. The negative lookbehind/lookahead keep the match to standalone
// words only. "his" is excluded because it also appears in "history",
// "this", etc. inside aria-labels; we match it with a strict word
// boundary too.
const PRONOUN_REGEX = /\b(she|her|hers|he|his|him)\b/i;

const FIRST_NAME = "Lennox";
const LAST_NAME = "Alvarez";
const SWIMMER_ID = "aaaa0000-0000-0000-0000-00000000000a";
const FREE_SKILL_ID = "bbbb0000-0000-0000-0000-00000000000a";
const FREE_CAT_ID = "cccc0000-0000-0000-0000-00000000000a";

const EMPTY_LEVEL_COUNTS = {
  level1: 0,
  level2: 0,
  level3: 0,
  level4: 0,
  level5: 0,
  notLegal: 0,
  noConcept: 0,
} as const;

// Shared "swimmer has one evaluation" fixture; detailed enough that both
// pages render all their non-empty sections (Snapshot, GroupStandings,
// Starts, Golf score, etc.). If a section has copy worth pronoun-
// guarding, we need to render it here.
function coachProgress(): SwimmerProgressResponse {
  return {
    skills: [
      {
        skillId: FREE_SKILL_ID,
        slug: "free-kick",
        name: "Freestyle Kick",
        categoryId: FREE_CAT_ID,
        categoryName: "Freestyle",
        type: "rubric",
        unit: null,
        ratedPerSide: false,
        parentSkillId: null,
        current: { grade: 3, notLegal: false, noConcept: false, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null },
        currentLeft: null,
        currentRight: null,
        history: [
          { id: "k2", sessionId: "s2", grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, edited: false, previousValue: null, context: "practice", faultTags: [], ratedAt: "2026-10-25T18:00:00.000Z", sessionDate: "2026-10-25" },
          { id: "k1", sessionId: "s1", grade: 2, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, edited: false, previousValue: null, context: "practice", faultTags: [], ratedAt: "2026-09-30T18:00:00.000Z", sessionDate: "2026-09-30" },
        ],
      },
      {
        skillId: "track-start-reaction-id",
        slug: "track-start-reaction",
        name: "Reaction",
        categoryId: FREE_CAT_ID,
        categoryName: "Freestyle",
        type: "measured",
        unit: "seconds",
        ratedPerSide: false,
        parentSkillId: null,
        current: { grade: 3, notLegal: false, noConcept: false, capacityValue: null, capacityUnit: null, measurementValue: "0.82", measurementUnit: "seconds" },
        currentLeft: null,
        currentRight: null,
        history: [
          { id: "r2", sessionId: "s2", grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: "0.82", measurementUnit: "seconds", edited: false, previousValue: null, context: "practice", faultTags: [], ratedAt: "2026-10-25T18:00:00.000Z", sessionDate: "2026-10-25" },
          { id: "r1", sessionId: "s1", grade: 2, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: "0.90", measurementUnit: "seconds", edited: false, previousValue: null, context: "practice", faultTags: [], ratedAt: "2026-09-30T18:00:00.000Z", sessionDate: "2026-09-30" },
        ],
      },
    ],
    startProgress: [
      {
        slug: "track-start",
        name: "Track Start",
        grade: { status: "graded", grade: 3 },
        components: [
          { slug: "track-start-reaction", name: "Reaction", current: { grade: 3, notLegal: false, noConcept: false, capacityValue: null, capacityUnit: null, measurementValue: "0.82", measurementUnit: "seconds" } },
        ],
      },
    ],
    headPositionOverall: 3,
    coachingPriorities: [
      { targetSlug: "free-pull", targetName: "Pull", chain: [{ slug: "free-pull", name: "Pull", notAssessed: false }] },
    ],
  };
}

function coachScoreHistory(): ScoreHistoryResponse {
  return {
    points: [
      {
        sessionDate: "2026-09-30",
        sessionId: "s1",
        headPositionOverall: 2,
        categoryRollups: [],
        screenGroupRollups: [
          { screenSlug: "freestyle", name: "Freestyle", average: 2, assessedCount: 1, totalCount: 2 },
          { screenSlug: "backstroke", name: "Backstroke", average: 1.5, assessedCount: 2, totalCount: 3 },
        ],
        starts: [],
        counts: { ...EMPTY_LEVEL_COUNTS },
        totalLevelsGained: 0,
        skillsMastered: 0,
        skillsLearned: 1,
      },
      {
        sessionDate: "2026-10-25",
        sessionId: "s2",
        headPositionOverall: 3,
        categoryRollups: [],
        screenGroupRollups: [
          { screenSlug: "freestyle", name: "Freestyle", average: 3, assessedCount: 2, totalCount: 2 },
          { screenSlug: "backstroke", name: "Backstroke", average: 2.5, assessedCount: 3, totalCount: 3 },
        ],
        starts: [{ slug: "track-start", name: "Track Start", grade: { status: "graded", grade: 3 } }],
        counts: { ...EMPTY_LEVEL_COUNTS },
        totalLevelsGained: 1,
        skillsMastered: 0,
        skillsLearned: 1,
      },
    ],
    recentChanges: [],
    milestones: [],
    faultTrends: [],
    measurements: [],
  };
}

const COACH_SWIMMER: CoachSwimmerDetail = {
  id: SWIMMER_ID,
  firstName: FIRST_NAME,
  lastName: LAST_NAME,
  age: 11,
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  birthDate: "2013-01-01",
  householdId: "00000000-0000-0000-0000-000000000ff0",
  currentLeagues: [],
  clubs: [],
  memberNames: [],
  lastLesson: null,
  members: [],
  homePool: null,
};

const PARENT_SWIMMER: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: FIRST_NAME,
  lastName: LAST_NAME,
  birthDate: "2013-01-01",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

function parentProgress(): ParentSwimmerProgressResponse {
  return {
    skills: [
      {
        skillId: FREE_SKILL_ID,
        slug: "free-kick",
        name: "Freestyle Kick",
        categoryId: FREE_CAT_ID,
        categoryName: "Freestyle",
        type: "rubric",
        unit: null,
        ratedPerSide: false,
        parentSkillId: null,
        current: { grade: 3, notLegal: false, noConcept: false, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null },
        currentLeft: null,
        currentRight: null,
        history: [
          { id: "k2", sessionId: "s2", grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, edited: false, previousValue: null, context: "practice", ratedAt: "2026-10-25T18:00:00.000Z", sessionDate: "2026-10-25" },
          { id: "k1", sessionId: "s1", grade: 2, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, edited: false, previousValue: null, context: "practice", ratedAt: "2026-09-30T18:00:00.000Z", sessionDate: "2026-09-30" },
        ],
      },
    ],
    startProgress: [
      {
        slug: "track-start",
        name: "Track Start",
        grade: { status: "graded", grade: 3 },
        components: [
          { slug: "track-start-reaction", name: "Reaction", current: { grade: 3, notLegal: false, noConcept: false, capacityValue: null, capacityUnit: null, measurementValue: "0.82", measurementUnit: "seconds" } },
        ],
      },
    ],
    headPositionOverall: 3,
    coachingPriorities: [
      { targetSlug: "free-pull", targetName: "Pull", chain: [{ slug: "free-pull", name: "Pull", notAssessed: false }] },
    ],
    latestCoachingPriority: {
      text: "Rotate the hips more on each stroke",
      sessionDate: "2026-10-25",
      coachFirstName: "Jordan",
    },
    latestCoachingNotes: [],
  };
}

function parentScoreHistory(): ParentScoreHistoryResponse {
  return {
    points: [
      {
        sessionDate: "2026-09-30",
        headPositionOverall: 2,
        categoryRollups: [],
        screenGroupRollups: [
          { screenSlug: "freestyle", name: "Freestyle", average: 2, assessedCount: 1, totalCount: 2 },
          { screenSlug: "backstroke", name: "Backstroke", average: 1.5, assessedCount: 2, totalCount: 3 },
        ],
        starts: [],
        counts: { ...EMPTY_LEVEL_COUNTS },
        totalLevelsGained: 0,
        skillsMastered: 0,
        skillsLearned: 1,
      },
      {
        sessionDate: "2026-10-25",
        headPositionOverall: 3,
        categoryRollups: [],
        screenGroupRollups: [
          { screenSlug: "freestyle", name: "Freestyle", average: 3, assessedCount: 2, totalCount: 2 },
          { screenSlug: "backstroke", name: "Backstroke", average: 2.5, assessedCount: 3, totalCount: 3 },
        ],
        starts: [{ slug: "track-start", name: "Track Start", grade: { status: "graded", grade: 3 } }],
        counts: { ...EMPTY_LEVEL_COUNTS },
        totalLevelsGained: 1,
        skillsMastered: 0,
        skillsLearned: 1,
      },
    ],
    recentChanges: [],
    milestones: [],
    measurements: [],
  };
}

const PARENT_GOLF: ParentGolfScoreTrendsResponse = {
  trends: [
    {
      skillSlug: "free-golf-score",
      skillName: "Freestyle golf score",
      byCategory: [
        {
          category: "push_off_in_water",
          ageBands: { bandCount: 10, p25: 20, p50: 24, p75: 28 },
          points: [
            { ratedAt: "2026-10-25T18:00:00.000Z", sessionDate: "2026-10-25", grade: 3, timeSeconds: 14, strokeCountValue: 22 },
          ],
        },
      ],
    },
  ],
};

const COACH_GOLF: GolfScoreTrendsResponse = {
  trends: PARENT_GOLF.trends.map((trend) => ({
    skillSlug: trend.skillSlug,
    skillName: trend.skillName,
    byCategory: trend.byCategory.map((cat) => ({
      category: cat.category,
      ageBands: cat.ageBands,
      points: cat.points.map((point) => ({
        ratedAt: point.ratedAt,
        sessionDate: point.sessionDate,
        sessionId: "s2",
        grade: point.grade,
        timeSeconds: point.timeSeconds,
        strokeCountValue: point.strokeCountValue,
      })),
    })),
  })),
};

const PARENT_CATEGORIES: ParentCategoriesResponse = [];
const COACH_CATEGORIES: CategoriesResponse = [];

function assertNoPronoun(label: string, text: string): void {
  const match = text.match(PRONOUN_REGEX);
  if (match !== null) {
    const start = Math.max(0, (match.index ?? 0) - 40);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 40);
    const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
    throw new Error(
      `${label}: hardcoded pronoun "${match[0]}" found in rendered text. ` +
      `Context: …${snippet}…. Replace with the swimmer's first name or neutral copy.`,
    );
  }
}

describe("progress pages — no hardcoded pronouns", () => {
  it("coach progress page renders no standalone she/her/he/his/him words", () => {
    const { container } = render(
      <SwimmerProgressContent
        swimmer={COACH_SWIMMER}
        progress={coachProgress()}
        categories={COACH_CATEGORIES}
        scoreHistory={coachScoreHistory()}
        golfScore={COACH_GOLF}
        nowIso="2026-10-29T18:00:00.000Z"
      />,
    );
    assertNoPronoun("coach progress", container.textContent ?? "");
  });

  it("parent progress page renders no standalone she/her/he/his/him words", () => {
    const { container } = render(
      <ParentSwimmerProgressContent
        swimmer={PARENT_SWIMMER}
        progress={parentProgress()}
        categories={PARENT_CATEGORIES}
        scoreHistory={parentScoreHistory()}
        golfScore={PARENT_GOLF}
      />,
    );
    assertNoPronoun("parent progress", container.textContent ?? "");
  });
});
