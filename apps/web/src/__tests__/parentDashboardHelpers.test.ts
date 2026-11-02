import { describe, expect, it } from "vitest";

import type {
  Club,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  UpcomingLesson,
} from "@swim-app/shared";

import {
  formatNextLessonLine,
  formatRelativeDay,
  latestEvaluationDate,
  nextLessonForSwimmer,
  swimmerClubName,
} from "../content/ParentDashboardContent/helpers";

function makeSwimmer(overrides: Partial<ParentSwimmer> = {}): ParentSwimmer {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    firstName: "Morgan",
    lastName: "Lee",
    birthDate: "2015-04-01",
    sex: "female",
    isPublic: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    clubs: [],
    currentLeagues: [],
    ...overrides,
  };
}

function makeLesson(startsAt: string, swimmerIds: string[]): UpcomingLesson {
  return {
    id: "lesson-" + startsAt,
    locationId: "00000000-0000-0000-0000-000000000011",
    startsAt,
    durationMinutes: 30,
    type: "private",
    status: "approved",
    swimmers: swimmerIds.map((id) => ({ swimmerId: id, firstName: "x", lastName: "y" })),
    expiresAt: null,
    approvedAt: null,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    locationName: "Jason's Pool",
    batchId: null,
    batchMode: null,
  };
}

describe("swimmerClubName", () => {
  it("returns the otherClubName when set", () => {
    const swimmer = makeSwimmer({
      clubs: [
        {
          id: "00000000-0000-0000-0000-000000000020",
          swimmerId: "00000000-0000-0000-0000-000000000001",
          clubId: null,
          otherClubName: "Backyard Pool",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    expect(swimmerClubName(swimmer, [])).toBe("Backyard Pool");
  });

  it("looks up the club by id when otherClubName is null", () => {
    const clubs: Club[] = [
      {
        id: "00000000-0000-0000-0000-000000000030",
        name: "Dragon Swim Club",
        isActive: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const swimmer = makeSwimmer({
      clubs: [
        {
          id: "00000000-0000-0000-0000-000000000021",
          swimmerId: "00000000-0000-0000-0000-000000000001",
          clubId: "00000000-0000-0000-0000-000000000030",
          otherClubName: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
    expect(swimmerClubName(swimmer, clubs)).toBe("Dragon Swim Club");
  });

  it("returns null when the swimmer has no clubs", () => {
    expect(swimmerClubName(makeSwimmer(), [])).toBeNull();
  });
});

describe("nextLessonForSwimmer", () => {
  it("returns the earliest lesson that includes this swimmer", () => {
    const lessons = [
      makeLesson("2026-11-20T20:00:00Z", ["other"]),
      makeLesson("2026-11-10T20:00:00Z", ["swimmer-abc"]),
      makeLesson("2026-11-05T20:00:00Z", ["swimmer-abc", "other"]),
    ];
    const next = nextLessonForSwimmer(lessons, "swimmer-abc");
    expect(next?.startsAt).toBe("2026-11-05T20:00:00Z");
  });

  it("returns null when the swimmer has no upcoming lessons", () => {
    const lessons = [makeLesson("2026-11-20T20:00:00Z", ["other"])];
    expect(nextLessonForSwimmer(lessons, "swimmer-abc")).toBeNull();
  });
});

describe("formatNextLessonLine", () => {
  it("formats weekday + LA time", () => {
    // 2026-11-05T20:00:00Z is 12:00 PM Pacific Standard Time (Nov 5 is PST)
    const line = formatNextLessonLine(makeLesson("2026-11-05T20:00:00Z", ["swimmer-abc"]));
    expect(line).toMatch(/^\w{3} at \d{1,2}:\d{2} (AM|PM)$/);
    expect(line).toContain("12:00 PM");
  });
});

describe("latestEvaluationDate", () => {
  it("returns null when there is no progress", () => {
    expect(latestEvaluationDate(null)).toBeNull();
  });

  it("picks the max sessionDate across notes, priority, and history", () => {
    const progress = {
      skills: [
        {
          history: [{ sessionDate: "2026-09-01" }, { sessionDate: "2026-10-10" }],
        },
      ],
      latestCoachingNotes: [
        { screenSlug: "start", screenName: "Start", text: "x", sessionDate: "2026-10-05" },
      ],
      latestCoachingPriority: { text: "x", sessionDate: "2026-10-20" },
    } as unknown as ParentSwimmerProgressResponse;
    expect(latestEvaluationDate(progress)).toBe("2026-10-20");
  });
});

describe("formatRelativeDay", () => {
  const now = new Date(Date.UTC(2026, 10, 15)); // 2026-11-15

  it("returns 'today' for same-day sessions", () => {
    expect(formatRelativeDay("2026-11-15", now)).toBe("today");
  });

  it("returns 'yesterday' for one day prior", () => {
    expect(formatRelativeDay("2026-11-14", now)).toBe("yesterday");
  });

  it("returns 'N days ago' within the first week", () => {
    expect(formatRelativeDay("2026-11-12", now)).toBe("3 days ago");
  });

  it("returns 'last week' between 7 and 13 days", () => {
    expect(formatRelativeDay("2026-11-05", now)).toBe("last week");
  });

  it("returns 'N weeks ago' between 14 and 59 days", () => {
    expect(formatRelativeDay("2026-10-15", now)).toBe("4 weeks ago");
  });

  it("falls back to a month-day label past 60 days", () => {
    const result = formatRelativeDay("2026-08-01", now);
    expect(result).toMatch(/Aug/);
    expect(result).toContain("1");
  });
});

