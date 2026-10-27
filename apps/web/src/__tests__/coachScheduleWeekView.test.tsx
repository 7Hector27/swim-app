// @vitest-environment node

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/coach/schedule",
}));

vi.mock("@/components/CoachLessonRow", () => ({
  default: ({ item }: { item: { lesson: { id: string } } }) =>
    `<div data-lesson="${item.lesson.id}"></div>`,
}));

const mockFetchSchedule = vi.fn();
const mockFetchWeekSchedule = vi.fn();

vi.mock("@/lib/api/lessons", () => ({
  fetchCoachSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
  fetchCoachWeekSchedule: (...args: unknown[]) => mockFetchWeekSchedule(...args),
}));

import CoachScheduleContent from "@/content/CoachScheduleContent/CoachScheduleContent";
import type { CoachWeekScheduleResponse } from "@swim-app/shared";

const MONDAY = "2026-10-19";
const TODAY = "2026-10-20";

function makeWeekResponse(
  lessonsByDate: Record<string, string[]> = {},
): CoachWeekScheduleResponse {
  const dates = [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ];
  return {
    days: dates.map((date) => ({
      date,
      items: (lessonsByDate[date] ?? []).map((id) => ({
        type: "lesson" as const,
        lesson: {
          id,
          householdId: "hh-1",
          locationId: "loc-1",
          startsAt: `${date}T23:00:00.000Z`,
          durationMinutes: 30 as const,
          type: "private" as const,
          status: "approved" as const,
          swimmers: [{ swimmerId: "sw-1", firstName: "Mia", lastName: "K", clubName: "Wave" }],
          expiresAt: null,
          approvedAt: null,
          declinedAt: null,
          declineReason: null,
          movedAt: null,
          previousStartsAt: null,
          createdAt: `${date}T00:00:00.000Z`,
        },
        locationName: "Egret Park",
        householdId: "hh-1",
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSchedule.mockResolvedValue([]);
});

describe("CoachScheduleContent — week view", () => {
  it("renders a Day/Week toggle with correct aria-current", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(html).toContain('aria-current="page"');
    // The "Week" link has aria-current; the "Day" link does not.
    expect(html).toMatch(/aria-current="page"[^>]*>Week/);
  });

  it("renders the week range label", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(html).toContain("Oct 19 to 25");
  });

  it("renders 7 day headings (shortDayLabel for Mon–Sun)", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    // Each day appears in both the desktop grid and phone stack → at least 2× each
    expect(html).toContain("Mon");
    expect(html).toContain("Sun");
  });

  it("shows 'No lessons.' for days with no items", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    // All 7 days have no lessons → "No lessons." appears 14 times (desktop + phone each day)
    const count = (html.match(/No lessons\./g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(7);
  });

  it("passes lesson items to CoachLessonRow for days that have lessons", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse({ "2026-10-20": ["lesson-xyz"] }));
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(html).toContain("lesson-xyz");
  });

  it("day column headers link to the day view for that date", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(html).toContain("view=day&amp;date=2026-10-19");
    expect(html).toContain("view=day&amp;date=2026-10-25");
  });

  it("shows a Today button when not on today's week", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({
        accessToken: "tok",
        date: "2026-11-02",
        view: "week",
        today: TODAY,
      }),
    );
    expect(html).toMatch(/>Today</);
  });

  it("hides the Today button when already on today's week", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      // MONDAY (2026-10-19) is the same week as TODAY (2026-10-20)
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(html).not.toMatch(/>Today</);
  });

  it("prev/next week links point to correct Mondays", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(html).toContain("view=week&amp;date=2026-10-12"); // prev week
    expect(html).toContain("view=week&amp;date=2026-10-26"); // next week
  });
});

describe("CoachScheduleContent — day view", () => {
  it("renders prev/next day links and the day label", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: TODAY, view: "day", today: TODAY }),
    );
    expect(html).toContain("Previous day");
    expect(html).toContain("Next day");
    expect(html).toContain("Today"); // the label span
    expect(html).toContain("view=day&amp;date=2026-10-19"); // prev day
    expect(html).toContain("view=day&amp;date=2026-10-21"); // next day
  });

  it("shows 'Tomorrow' label when date is one day ahead of today", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({
        accessToken: "tok",
        date: "2026-10-21",
        view: "day",
        today: TODAY,
      }),
    );
    expect(html).toContain("Tomorrow");
  });

  it("shows formatted date label for non-today non-tomorrow dates", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({
        accessToken: "tok",
        date: "2026-10-19",
        view: "day",
        today: TODAY,
      }),
    );
    expect(html).toContain("Monday");
    expect(html).toContain("October");
  });

  it("hides the Today button when already on today", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: TODAY, view: "day", today: TODAY }),
    );
    // "Today" appears as the label span but NOT as a separate button
    // The Today button link only renders when date !== today
    const todayButtonCount = (html.match(/href="[^"]*view=day[^"]*date=2026-10-20[^"]*"[^>]*>Today/g) ?? []).length;
    expect(todayButtonCount).toBe(0);
  });

  it("shows the empty state when there are no items", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "tok", date: TODAY, view: "day", today: TODAY }),
    );
    expect(html).toContain("No lessons for this day.");
  });

  it("calls fetchCoachSchedule with the access token and date", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "my-token", date: TODAY, view: "day", today: TODAY }),
    );
    expect(mockFetchSchedule).toHaveBeenCalledWith("my-token", TODAY);
  });

  it("calls fetchCoachWeekSchedule with the access token and date in week view", async () => {
    mockFetchWeekSchedule.mockResolvedValue(makeWeekResponse());
    await renderToStaticMarkup(
      await CoachScheduleContent({ accessToken: "my-token", date: MONDAY, view: "week", today: TODAY }),
    );
    expect(mockFetchWeekSchedule).toHaveBeenCalledWith("my-token", MONDAY);
  });
});
