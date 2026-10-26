import { describe, it, expect } from "vitest";
import type { UpcomingLesson } from "@swim-app/shared";

import { lessonDateLA, weekGroupLabel, groupLessonsByWeek } from "../content/ParentLessonsContent/weekGroups";

// Fixed anchor: today's Monday is 2026-10-19 (Mon Oct 19, 2026 PDT)
const TODAY_MONDAY = "2026-10-19";

const makeLesson = (id: string, startsAt: string): UpcomingLesson => ({
  id,
  locationId: "loc-1",
  locationName: "Main Pool",
  startsAt,
  durationMinutes: 45,
  type: "private",
  status: "approved",
  swimmers: [],
  expiresAt: null,
  approvedAt: null,
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  batchId: null,
  batchMode: null,
});

// ── lessonDateLA ──────────────────────────────────────────────────────────────

describe("lessonDateLA", () => {
  it("returns the LA calendar date for a UTC noon datetime", () => {
    // Oct 20 20:00 UTC = Oct 20 1:00 PM PDT
    expect(lessonDateLA("2026-10-20T20:00:00.000Z")).toBe("2026-10-20");
  });

  it("returns the previous calendar day when UTC midnight is still yesterday in LA (PDT)", () => {
    // Oct 20 06:30 UTC = Oct 19 11:30 PM PDT
    expect(lessonDateLA("2026-10-20T06:30:00.000Z")).toBe("2026-10-19");
  });

  it("returns the correct date across the month boundary", () => {
    // Oct 31 23:00 UTC = Oct 31 4:00 PM PDT
    expect(lessonDateLA("2026-10-31T23:00:00.000Z")).toBe("2026-10-31");
    // Nov 1 20:00 UTC = Nov 1 12:00 PM PST (DST ends Nov 1 at 2am PDT)
    expect(lessonDateLA("2026-11-01T20:00:00.000Z")).toBe("2026-11-01");
  });

  it("handles DST fall-back: Nov 1 at 1 AM appears twice, pick PST side", () => {
    // Nov 1 09:00 UTC = Nov 1 01:00 PST (after fall-back; UTC-8)
    expect(lessonDateLA("2026-11-01T09:00:00.000Z")).toBe("2026-11-01");
  });
});

// ── weekGroupLabel ────────────────────────────────────────────────────────────

describe("weekGroupLabel", () => {
  it("returns 'This week' for the current Monday", () => {
    expect(weekGroupLabel(TODAY_MONDAY, TODAY_MONDAY)).toBe("This week");
  });

  it("returns 'Next week' for the following Monday", () => {
    expect(weekGroupLabel("2026-10-26", TODAY_MONDAY)).toBe("Next week");
  });

  it("returns 'Week of Nov 2' for the week starting Nov 2", () => {
    expect(weekGroupLabel("2026-11-02", TODAY_MONDAY)).toBe("Week of Nov 2");
  });

  it("returns 'Week of Nov 9' for the week starting Nov 9", () => {
    expect(weekGroupLabel("2026-11-09", TODAY_MONDAY)).toBe("Week of Nov 9");
  });

  it("returns 'Week of Dec 28' for a week crossing into the new year", () => {
    expect(weekGroupLabel("2026-12-28", TODAY_MONDAY)).toBe("Week of Dec 28");
  });

  it("returns a 'Week of' label for a past week (not This/Next)", () => {
    expect(weekGroupLabel("2026-10-12", TODAY_MONDAY)).toBe("Week of Oct 12");
  });
});

// ── groupLessonsByWeek ────────────────────────────────────────────────────────

describe("groupLessonsByWeek", () => {
  it("puts two lessons in the same week into one group", () => {
    const lessons = [
      makeLesson("a", "2026-10-19T20:00:00.000Z"), // Mon Oct 19 1PM PDT — this week
      makeLesson("b", "2026-10-23T20:00:00.000Z"), // Fri Oct 23 1PM PDT — this week
    ];
    const groups = groupLessonsByWeek(lessons, TODAY_MONDAY);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("This week");
    expect(groups[0]?.lessons).toHaveLength(2);
  });

  it("splits lessons across different weeks into separate groups", () => {
    const lessons = [
      makeLesson("a", "2026-10-19T20:00:00.000Z"), // this week
      makeLesson("b", "2026-10-26T20:00:00.000Z"), // next week
      makeLesson("c", "2026-11-02T20:00:00.000Z"), // Week of Nov 2
    ];
    const groups = groupLessonsByWeek(lessons, TODAY_MONDAY);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.label).toBe("This week");
    expect(groups[1]?.label).toBe("Next week");
    expect(groups[2]?.label).toBe("Week of Nov 2");
  });

  it("lessons across a month boundary land in the right week", () => {
    // Oct 31 (Sat, this week's week ends Oct 25; Oct 26 starts next week; Oct 31 is next week's Saturday)
    // next week = Oct 26 to Nov 1; week after = Nov 2–8
    const lessons = [
      makeLesson("a", "2026-10-31T20:00:00.000Z"), // Sat Oct 31 — next week
      makeLesson("b", "2026-11-01T20:00:00.000Z"), // Sun Nov 1 — next week
      makeLesson("c", "2026-11-02T20:00:00.000Z"), // Mon Nov 2 — Week of Nov 2
      makeLesson("d", "2026-11-03T20:00:00.000Z"), // Tue Nov 3 — Week of Nov 2
    ];
    const groups = groupLessonsByWeek(lessons, TODAY_MONDAY);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe("Next week");
    expect(groups[0]?.lessons).toHaveLength(2);
    expect(groups[1]?.label).toBe("Week of Nov 2");
    expect(groups[1]?.lessons).toHaveLength(2);
  });

  it("returns an empty array for no lessons", () => {
    expect(groupLessonsByWeek([], TODAY_MONDAY)).toHaveLength(0);
  });

  it("preserves lesson order within a group", () => {
    const lessons = [
      makeLesson("early", "2026-10-19T17:00:00.000Z"), // 10 AM PDT
      makeLesson("late",  "2026-10-19T23:00:00.000Z"), // 4 PM PDT
    ];
    const groups = groupLessonsByWeek(lessons, TODAY_MONDAY);
    expect(groups[0]?.lessons[0]?.id).toBe("early");
    expect(groups[0]?.lessons[1]?.id).toBe("late");
  });

  it("merges page 2 lessons into existing week groups correctly", () => {
    // Page 1: this week + start of next week
    const page1 = [
      makeLesson("p1-a", "2026-10-20T20:00:00.000Z"), // this week
      makeLesson("p1-b", "2026-10-21T20:00:00.000Z"), // this week
      makeLesson("p1-c", "2026-10-26T20:00:00.000Z"), // next week
      makeLesson("p1-d", "2026-10-27T20:00:00.000Z"), // next week
    ];
    // Page 2: more of next week + new week
    const page2 = [
      makeLesson("p2-a", "2026-10-28T20:00:00.000Z"), // next week
      makeLesson("p2-b", "2026-10-29T20:00:00.000Z"), // next week
      makeLesson("p2-c", "2026-11-02T20:00:00.000Z"), // Week of Nov 2
    ];

    const groups = groupLessonsByWeek([...page1, ...page2], TODAY_MONDAY);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.label).toBe("This week");
    expect(groups[0]?.lessons).toHaveLength(2);
    expect(groups[1]?.label).toBe("Next week");
    expect(groups[1]?.lessons).toHaveLength(4); // 2 from page1 + 2 from page2
    expect(groups[2]?.label).toBe("Week of Nov 2");
    expect(groups[2]?.lessons).toHaveLength(1);
  });
});
