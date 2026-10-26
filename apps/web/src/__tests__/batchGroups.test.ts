// Covers the pure grouping helpers that the coach pending list uses to
// collapse same-batch pending lessons into one card (ADR 030 phase 3).

import { describe, it, expect } from "vitest";
import type { LessonResponse } from "@swim-app/shared";

import {
  buildGroups,
  firstStartsAt,
  type PendingGroup,
} from "../content/CoachDashboardContent/batchGroups";

function makeLesson(overrides: Partial<LessonResponse>): LessonResponse {
  return {
    id: "lesson-id",
    householdId: "household-id",
    locationId: "loc-id",
    startsAt: "2035-11-15T20:30:00.000Z",
    durationMinutes: 30,
    type: "private",
    status: "pending",
    swimmers: [{ swimmerId: "s1", firstName: "Alex", lastName: "Carbajal" }],
    expiresAt: null,
    approvedAt: null,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: "2035-11-01T00:00:00.000Z",
    batchId: null,
    batchMode: null,
    ...overrides,
  };
}

describe("buildGroups", () => {
  it("collapses two-plus same-batch lessons into one batch group", () => {
    const batchId = "11111111-1111-1111-1111-111111111111";
    const groups = buildGroups([
      makeLesson({ id: "a", batchId, batchMode: "weekly", startsAt: "2035-11-18T20:30:00.000Z" }),
      makeLesson({ id: "b", batchId, batchMode: "weekly", startsAt: "2035-11-25T20:30:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.kind).toBe("batch");
    if (group.kind === "batch") {
      expect(group.batchId).toBe(batchId);
      expect(group.batchMode).toBe("weekly");
      expect(group.lessons.map((lesson) => lesson.id).sort()).toEqual(["a", "b"]);
    }
  });

  it("keeps solo lessons as solo and collapses one-member batches back to solo", () => {
    const soloBatchId = "22222222-2222-2222-2222-222222222222";
    const groups = buildGroups([
      makeLesson({ id: "solo-1" }),
      makeLesson({
        id: "solo-2",
        batchId: soloBatchId,
        batchMode: "manual",
      }),
    ]);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.kind).toBe("solo");
    }
  });

  it("sorts groups by the earliest pending startsAt so the most imminent floats up", () => {
    const laterBatchId = "33333333-3333-3333-3333-333333333333";
    const groups = buildGroups([
      // A later-dated batch comes in first in the input array.
      makeLesson({
        id: "late-a",
        batchId: laterBatchId,
        batchMode: "weekly",
        startsAt: "2035-12-10T20:30:00.000Z",
      }),
      makeLesson({
        id: "late-b",
        batchId: laterBatchId,
        batchMode: "weekly",
        startsAt: "2035-12-17T20:30:00.000Z",
      }),
      // An earlier-dated solo lesson comes in later in the input array.
      makeLesson({ id: "early-solo", startsAt: "2035-11-20T20:30:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kind).toBe("solo");
    expect(groups[1]!.kind).toBe("batch");
  });

  it("treats a lesson with batchId but no batchMode as solo (defensive)", () => {
    const groups = buildGroups([
      makeLesson({ id: "lesson", batchId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe("solo");
  });
});

describe("firstStartsAt", () => {
  it("returns a solo group's own startsAt", () => {
    const solo: PendingGroup = { kind: "solo", lesson: makeLesson({ startsAt: "2035-11-18T20:30:00.000Z" }) };
    expect(firstStartsAt(solo)).toBe("2035-11-18T20:30:00.000Z");
  });

  it("returns the earliest startsAt of a batch group's lessons", () => {
    const batch: PendingGroup = {
      kind: "batch",
      batchId: "bb",
      batchMode: "weekly",
      lessons: [
        makeLesson({ id: "a", startsAt: "2035-11-25T20:30:00.000Z" }),
        makeLesson({ id: "b", startsAt: "2035-11-18T20:30:00.000Z" }),
        makeLesson({ id: "c", startsAt: "2035-12-02T20:30:00.000Z" }),
      ],
    };
    expect(firstStartsAt(batch)).toBe("2035-11-18T20:30:00.000Z");
  });
});
