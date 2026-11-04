// Covers the audit's "500 looks like 404" primary-fetch bug:
// coach/lessons/[id]/page.tsx must call notFound() on a true 404 from
// /coach/lessons/:id, and throw (so the route error boundary renders) on any
// other non-ok status. The old fetch helper returned null for both cases,
// collapsing them into one path.

import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockNotFound, mockRedirect, mockRequireAuth, mockFetchCoachLesson, mockFetchLessonNotes } =
  vi.hoisted(() => ({
    mockNotFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    mockRedirect: vi.fn((target: string) => {
      throw new Error(`NEXT_REDIRECT:${target}`);
    }),
    mockRequireAuth: vi.fn(),
    mockFetchCoachLesson: vi.fn(),
    mockFetchLessonNotes: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}));
vi.mock("@/lib/requireAuth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/lib/api/lessons", () => ({
  fetchCoachLesson: mockFetchCoachLesson,
  fetchLessonNotes: mockFetchLessonNotes,
}));
vi.mock("@/components/AccountInactiveScreen", () => ({
  default: () => null,
}));
vi.mock("@/content/CoachLessonDetailContent", () => ({
  default: () => null,
}));

import CoachLessonPage from "../app/coach/lessons/[id]/page";

const LESSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";

beforeEach(() => {
  mockNotFound.mockClear();
  mockRedirect.mockClear();
  mockRequireAuth.mockReset();
  mockFetchCoachLesson.mockReset();
  mockFetchLessonNotes.mockReset();
  mockRequireAuth.mockResolvedValue({
    profile: {
      id: "coach-1",
      email: "jason@example.com",
      fullName: "Jason",
      phone: null,
      role: "coach",
    },
    accessToken: "token-xyz",
  });
  mockFetchLessonNotes.mockResolvedValue([]);
});

describe("coach/lessons/[id]/page — primary fetch error routing", () => {
  it("calls notFound() when the lesson fetch returns 404", async () => {
    mockFetchCoachLesson.mockResolvedValue({ ok: false, status: 404 });

    await expect(
      CoachLessonPage({ params: Promise.resolve({ id: LESSON_ID }) }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);

    expect(mockNotFound).toHaveBeenCalledTimes(1);
    // notFound must short-circuit before fetchLessonNotes is called.
    expect(mockFetchLessonNotes).not.toHaveBeenCalled();
  });

  it("throws (so the route error boundary renders) when the lesson fetch returns 500", async () => {
    mockFetchCoachLesson.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      CoachLessonPage({ params: Promise.resolve({ id: LESSON_ID }) }),
    ).rejects.toThrow(/Failed to load lesson \(status 500\)/);

    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("throws on 503 as well — any non-404 non-ok status is a route-error-boundary case", async () => {
    mockFetchCoachLesson.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      CoachLessonPage({ params: Promise.resolve({ id: LESSON_ID }) }),
    ).rejects.toThrow(/Failed to load lesson \(status 503\)/);

    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("does not throw when the lesson is found (ok path)", async () => {
    mockFetchCoachLesson.mockResolvedValue({
      ok: true,
      lesson: {
        id: LESSON_ID,
        status: "approved",
      },
    });

    await expect(
      CoachLessonPage({ params: Promise.resolve({ id: LESSON_ID }) }),
    ).resolves.toBeDefined();

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockFetchLessonNotes).toHaveBeenCalledWith("token-xyz", LESSON_ID);
  });
});
