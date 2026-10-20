// @vitest-environment node
import { vi, it, expect, describe, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachScheduleItem, MeResponse } from "@swim-app/shared";

const { mockFetchMe, mockFetchCoachSchedule, mockRedirect } = vi.hoisted(() => ({
  mockFetchMe: vi.fn(),
  mockFetchCoachSchedule: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    throw err;
  }),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, cache: (fn: unknown) => fn };
});

vi.mock("@/lib/api/me", () => ({ fetchMe: mockFetchMe }));
vi.mock("@/lib/api/lessons", () => ({ fetchCoachSchedule: mockFetchCoachSchedule }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

// CoachLessonRow is "use client" and uses hooks; stub it for the node environment.
vi.mock("@/content/CoachScheduleContent/CoachLessonRow", () => ({
  default: ({ item }: { item: CoachScheduleItem }) => (
    <div data-lesson-id={(item as { lesson?: { id: string } }).lesson?.id ?? "no-id"} />
  ),
}));

import CoachSchedulePage from "../app/coach/schedule/page";

const COACH: MeResponse = {
  email: "jason@mail.com",
  fullName: "Jason Guzman",
  phone: null,
  role: "coach",
};

const OPEN_SLOT: CoachScheduleItem = {
  type: "open_slot",
  startsAt: "2026-10-20T17:00:00.000Z",
  endsAt: "2026-10-20T18:00:00.000Z",
};

beforeEach(() => {
  mockFetchMe.mockReset();
  mockFetchCoachSchedule.mockReset();
  mockRedirect.mockClear();
});

describe("CoachSchedulePage — data load", () => {
  it("calls fetchCoachSchedule with the session token and date", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSchedule.mockResolvedValue([OPEN_SLOT]);

    await CoachSchedulePage({
      searchParams: Promise.resolve({ date: "2026-10-20" }),
    });

    expect(mockFetchCoachSchedule).toHaveBeenCalledWith("coach-tok", "2026-10-20");
  });

  it("falls back to todayLA() when no date param is given", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSchedule.mockResolvedValue([]);

    await CoachSchedulePage({ searchParams: Promise.resolve({}) });

    expect(mockFetchCoachSchedule).toHaveBeenCalledTimes(1);
    const [, dateArg] = (mockFetchCoachSchedule as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("renders the empty-state message when no items are returned", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSchedule.mockResolvedValue([]);

    const rendered = await CoachSchedulePage({
      searchParams: Promise.resolve({ date: "2026-10-20" }),
    });
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain("No lessons or open slots for this day.");
  });

  it("renders schedule rows when items are returned", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSchedule.mockResolvedValue([OPEN_SLOT]);

    const rendered = await CoachSchedulePage({
      searchParams: Promise.resolve({ date: "2026-10-20" }),
    });
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain("Open until");
  });

  it("returns null when requireAuth returns null (forbidden)", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 403 });

    const rendered = await CoachSchedulePage({
      searchParams: Promise.resolve({}),
    });

    expect(rendered).toBeNull();
    expect(mockFetchCoachSchedule).not.toHaveBeenCalled();
  });
});
