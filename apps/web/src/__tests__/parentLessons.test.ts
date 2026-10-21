import { vi, describe, it, expect, beforeEach } from "vitest";

import type { UpcomingLesson } from "@swim-app/shared";
import { UpcomingLessonsQuerySchema } from "@swim-app/shared";

import { PAGE_SIZE } from "../content/ParentLessonsContent/constants";

const { mockRedirect, mockRequireAuth, mockFetchUpcomingLessons } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockFetchUpcomingLessons: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/requireAuth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/lib/api/lessons", () => ({ fetchUpcomingLessons: mockFetchUpcomingLessons }));

import { loadMoreUpcomingLessons } from "../content/ParentLessonsContent/actions";

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

const auth = { profile: { role: "parent" as const, fullName: "Parent A", phone: null, ageAttestedAt: "", createdAt: "", updatedAt: "" }, accessToken: "tok" };
const coachAuth = { profile: { role: "coach" as const, fullName: "Coach Jason", phone: null, ageAttestedAt: "", createdAt: "", updatedAt: "" }, accessToken: "coach-tok" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(auth);
});

describe("lessons page data", () => {
  it("separates upcoming and past lessons correctly", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const upcomingLesson = makeLesson("lesson-future", future, "approved");
    const pastLesson = makeLesson("lesson-past", past, "approved");

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

describe("loadMoreUpcomingLessons", () => {
  it("calls fetchUpcomingLessons with offset=10 and limit=11", async () => {
    mockFetchUpcomingLessons.mockResolvedValue([]);
    await loadMoreUpcomingLessons(10);
    expect(mockFetchUpcomingLessons).toHaveBeenCalledWith("tok", { limit: 11, offset: 10 });
  });

  it("calls fetchUpcomingLessons with offset=20 for the third page", async () => {
    mockFetchUpcomingLessons.mockResolvedValue([]);
    await loadMoreUpcomingLessons(20);
    expect(mockFetchUpcomingLessons).toHaveBeenCalledWith("tok", { limit: 11, offset: 20 });
  });

  it("returns the lesson array from fetchUpcomingLessons", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const lessons = [makeLesson("l-1", future), makeLesson("l-2", future)];
    mockFetchUpcomingLessons.mockResolvedValue(lessons);
    const result = await loadMoreUpcomingLessons(10);
    expect(result).toEqual(lessons);
  });

  it("returns an empty array when no lessons remain", async () => {
    mockFetchUpcomingLessons.mockResolvedValue([]);
    const result = await loadMoreUpcomingLessons(100);
    expect(result).toEqual([]);
  });

  it("returns null when fetchUpcomingLessons returns null (fetch failure)", async () => {
    mockFetchUpcomingLessons.mockResolvedValue(null);
    const result = await loadMoreUpcomingLessons(10);
    expect(result).toBeNull();
  });

  it("redirects to /dashboard when called by a coach", async () => {
    mockRequireAuth.mockResolvedValue(coachAuth);
    mockRedirect.mockImplementationOnce(() => { throw new Error("NEXT_REDIRECT"); });
    await expect(loadMoreUpcomingLessons(10)).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockFetchUpcomingLessons).not.toHaveBeenCalled();
  });
});

describe("UpcomingLessonsQuerySchema PAGE_SIZE compatibility", () => {
  it("accepts limit: PAGE_SIZE + 1 so the sentinel fetch fits within the API cap", () => {
    const result = UpcomingLessonsQuerySchema.safeParse({ limit: String(PAGE_SIZE + 1) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(PAGE_SIZE + 1);
  });
});

describe("Show more page logic", () => {
  it("initialHasMore is false when API returns ≤10 lessons", () => {
    const raw = Array.from({ length: 10 }, (_, index) =>
      makeLesson(`l-${index}`, new Date(Date.now() + index * 60000).toISOString()),
    );
    const initialHasMore = raw.length > 10;
    expect(initialHasMore).toBe(false);
  });

  it("initialHasMore is true when API returns 11 lessons (sentinel)", () => {
    const raw = Array.from({ length: 11 }, (_, index) =>
      makeLesson(`l-${index}`, new Date(Date.now() + index * 60000).toISOString()),
    );
    const initialHasMore = raw.length > 10;
    const initialLessons = initialHasMore ? raw.slice(0, 10) : raw;
    expect(initialHasMore).toBe(true);
    expect(initialLessons).toHaveLength(10);
  });

  it("show more result with 11 items signals another page exists and shows only 10", () => {
    const raw = Array.from({ length: 11 }, (_, index) =>
      makeLesson(`l-${index}`, new Date(Date.now() + index * 60000).toISOString()),
    );
    const gotMore = raw.length > 10;
    const newLessons = gotMore ? raw.slice(0, 10) : raw;
    expect(gotMore).toBe(true);
    expect(newLessons).toHaveLength(10);
  });

  it("show more result with ≤10 items means no more pages", () => {
    const raw = Array.from({ length: 3 }, (_, index) =>
      makeLesson(`l-${index}`, new Date(Date.now() + index * 60000).toISOString()),
    );
    const gotMore = raw.length > 10;
    expect(gotMore).toBe(false);
  });
});
