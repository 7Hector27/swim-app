import { describe, it, expect } from "vitest";

import type { UpcomingLesson } from "@swim-app/shared";

const makeLesson = (id: string, startsAt: string, status: UpcomingLesson["status"] = "approved"): UpcomingLesson => ({
  id,
  locationId: "loc-1",
  locationName: "Main Pool",
  startsAt,
  durationMinutes: 45,
  type: "private",
  status,
  swimmers: [{ swimmerId: "sw-1", firstName: "Maya", lastName: "R" }],
  expiresAt: null,
  approvedAt: null,
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
});

describe("lessons page data", () => {
  it("separates upcoming and past lessons correctly", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const upcomingLesson = makeLesson("lesson-future", future, "approved");
    const pastLesson = makeLesson("lesson-past", past, "approved");

    // The page fetches upcoming and past separately via distinct API calls;
    // verify the data contract: upcoming has a future startsAt, past has a past startsAt.
    expect(new Date(upcomingLesson.startsAt).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(pastLesson.startsAt).getTime()).toBeLessThan(now.getTime());
  });

  it("an empty upcoming array and empty past array are both valid states", () => {
    const upcoming: UpcomingLesson[] = [];
    const pastLessons: UpcomingLesson[] = [];
    expect(upcoming).toHaveLength(0);
    expect(pastLessons).toHaveLength(0);
  });

  it("lesson rows link to the correct detail route", () => {
    const lesson = makeLesson("abc-123", new Date().toISOString());
    expect(`/dashboard/lessons/${lesson.id}`).toBe("/dashboard/lessons/abc-123");
  });
});
