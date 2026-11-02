import { describe, expect, it } from "vitest";

import type { Club, ParentSwimmer } from "@swim-app/shared";

import {
  formatLessonDayTime,
  formatRelativeDay,
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

describe("formatLessonDayTime", () => {
  // 2026-11-05T20:00:00Z is 12:00 PM Pacific Standard Time (Nov 5 is PST)
  const iso = "2026-11-05T20:00:00Z";

  it("returns a short weekday + LA time by default", () => {
    expect(formatLessonDayTime(iso, { weekday: "short" })).toBe("Thu at 12:00 PM");
  });

  it("returns a long weekday + LA time when weekday: 'long'", () => {
    expect(formatLessonDayTime(iso, { weekday: "long" })).toBe("Thursday at 12:00 PM");
  });

  it("stays on LA calendar even when the UTC time is on the next day", () => {
    // 2026-11-06T07:00:00Z is 11 PM Pacific on Nov 5 (PST).
    const nightOfNov5 = "2026-11-06T07:00:00Z";
    expect(formatLessonDayTime(nightOfNov5, { weekday: "short" })).toBe("Thu at 11:00 PM");
  });
});

describe("formatRelativeDay", () => {
  // 2026-11-15 10:00 UTC == 2026-11-15 02:00 PST, well inside Nov 15 LA.
  const laNov15Morning = new Date(Date.UTC(2026, 10, 15, 10, 0));

  it("returns 'today' for same-day sessions", () => {
    expect(formatRelativeDay("2026-11-15", laNov15Morning)).toBe("today");
  });

  it("returns 'yesterday' for one day prior", () => {
    expect(formatRelativeDay("2026-11-14", laNov15Morning)).toBe("yesterday");
  });

  it("returns 'N days ago' within the first week", () => {
    expect(formatRelativeDay("2026-11-12", laNov15Morning)).toBe("3 days ago");
  });

  it("returns 'last week' between 7 and 13 days", () => {
    expect(formatRelativeDay("2026-11-05", laNov15Morning)).toBe("last week");
  });

  it("returns 'N weeks ago' between 14 and 59 days", () => {
    expect(formatRelativeDay("2026-10-15", laNov15Morning)).toBe("4 weeks ago");
  });

  it("falls back to a month-day label past 60 days", () => {
    const result = formatRelativeDay("2026-08-01", laNov15Morning);
    expect(result).toMatch(/Aug/);
    expect(result).toContain("1");
  });

  // LA-timezone boundary: an evaluation logged on Nov 15 (LA calendar day)
  // must still read "today" at 11:30 PM Pacific, not flip to "yesterday"
  // just because UTC has rolled past midnight.
  it("still reads 'today' at 11:30 PM Pacific (UTC past midnight)", () => {
    // 2026-11-16T07:30:00Z is 11:30 PM PST on 2026-11-15.
    const lateNov15 = new Date(Date.UTC(2026, 10, 16, 7, 30));
    expect(formatRelativeDay("2026-11-15", lateNov15)).toBe("today");
  });

  // The counterpart: once LA midnight has passed, the previous day's session
  // reads as "yesterday" — even though the UTC clock has only advanced a few
  // hours past the moment LA just rolled over.
  it("reads 'yesterday' just after midnight Pacific the next day", () => {
    // 2026-11-16T08:30:00Z is 12:30 AM PST on 2026-11-16.
    const earlyNov16 = new Date(Date.UTC(2026, 10, 16, 8, 30));
    expect(formatRelativeDay("2026-11-15", earlyNov16)).toBe("yesterday");
  });
});
