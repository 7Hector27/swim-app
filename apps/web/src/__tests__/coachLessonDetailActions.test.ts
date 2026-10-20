import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockRedirect, mockGetSession, mockFetch } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockGetSession: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getSession: mockGetSession },
  }),
}));
vi.mock("@/lib/apiErrorMessage", () => ({
  apiErrorMessage: (code: string | undefined) => code ?? "Something went wrong.",
}));

global.fetch = mockFetch;

import {
  approveCoachLessonAction,
  declineCoachLessonAction,
} from "../content/CoachLessonDetailContent/actions";
import type { CoachLessonDetailState } from "../content/CoachLessonDetailContent/actions";

const LESSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const idle: CoachLessonDetailState = { status: "idle" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

describe("approveCoachLessonAction", () => {
  it("calls redirect to the lesson page on success", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const fd = new FormData();
    fd.set("lessonId", LESSON_ID);

    await approveCoachLessonAction(idle, fd);

    expect(mockRedirect).toHaveBeenCalledWith(`/coach/lessons/${LESSON_ID}`);
  });

  it("returns error state when the API responds with a failure", async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const fd = new FormData();
    fd.set("lessonId", LESSON_ID);

    const result = await approveCoachLessonAction(idle, fd);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error" });
  });

  it("returns error state when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    const fd = new FormData();
    fd.set("lessonId", LESSON_ID);

    const result = await approveCoachLessonAction(idle, fd);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error", message: "Could not reach the server. Please try again." });
  });
});

describe("declineCoachLessonAction", () => {
  it("calls redirect to the lesson page on success", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const fd = new FormData();
    fd.set("lessonId", LESSON_ID);

    await declineCoachLessonAction(idle, fd);

    expect(mockRedirect).toHaveBeenCalledWith(`/coach/lessons/${LESSON_ID}`);
  });
});
