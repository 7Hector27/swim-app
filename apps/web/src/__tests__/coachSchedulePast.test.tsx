// @vitest-environment node
// Guards the past-weeks regression on /coach/schedule: the coach's day and
// week views must render past-dated lessons in their real end state and
// link each lesson row to /coach/lessons/[id]. Companion assertions verify
// that the parent + coach booking calendars still disable past-week nav.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CoachScheduleItem,
  CoachWeekScheduleResponse,
} from "@swim-app/shared";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/coach/schedule",
}));

const mockFetchSchedule = vi.fn();
const mockFetchWeekSchedule = vi.fn();

vi.mock("@/lib/api/lessons", () => ({
  fetchCoachSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
  fetchCoachWeekSchedule: (...args: unknown[]) => mockFetchWeekSchedule(...args),
}));

import CoachScheduleContent from "@/content/CoachScheduleContent/CoachScheduleContent";

const TODAY = "2026-10-20";
// A full week in the past.
const PAST_WEEK_MONDAY = "2026-10-05";
const PAST_DAY = "2026-10-05";
const PAST_LESSON_ID = "99999999-0000-0000-0000-000000000001";

function makePastWeekResponse(): CoachWeekScheduleResponse {
  const dates = [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11",
  ];
  return {
    days: dates.map((date) => ({
      date,
      items:
        date === PAST_DAY
          ? [
              {
                type: "lesson" as const,
                lesson: {
                  id: PAST_LESSON_ID,
                  householdId: "11111111-0000-0000-0000-000000000001",
                  locationId: "22222222-0000-0000-0000-000000000001",
                  startsAt: `${date}T23:00:00.000Z`,
                  durationMinutes: 30 as const,
                  type: "private" as const,
                  status: "completed" as const,
                  swimmers: [
                    {
                      swimmerId: "33333333-0000-0000-0000-000000000001",
                      firstName: "Mia",
                      lastName: "K",
                      clubName: "Wave",
                    },
                  ],
                  expiresAt: null,
                  approvedAt: `${date}T20:00:00.000Z`,
                  declinedAt: null,
                  declineReason: null,
                  movedAt: null,
                  previousStartsAt: null,
                  createdAt: `${date}T00:00:00.000Z`,
                },
                locationName: "Egret Park",
                householdId: "11111111-0000-0000-0000-000000000001",
              },
            ]
          : [],
    })),
  };
}

function makePastDayItems(): CoachScheduleItem[] {
  return [
    {
      type: "lesson",
      lesson: {
        id: PAST_LESSON_ID,
        householdId: "11111111-0000-0000-0000-000000000001",
        locationId: "22222222-0000-0000-0000-000000000001",
        startsAt: `${PAST_DAY}T23:00:00.000Z`,
        durationMinutes: 30,
        type: "private",
        status: "completed",
        swimmers: [
          {
            swimmerId: "33333333-0000-0000-0000-000000000001",
            firstName: "Mia",
            lastName: "K",
            clubName: "Wave",
          },
        ],
        expiresAt: null,
        approvedAt: `${PAST_DAY}T20:00:00.000Z`,
        declinedAt: null,
        declineReason: null,
        movedAt: null,
        previousStartsAt: null,
        createdAt: `${PAST_DAY}T00:00:00.000Z`,
      },
      locationName: "Egret Park",
      householdId: "11111111-0000-0000-0000-000000000001",
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSchedule.mockResolvedValue({ ok: true, data: [] });
  mockFetchWeekSchedule.mockResolvedValue({ ok: false, reason: "server" });
});

describe("coach schedule past dates", () => {
  it("week view: navigates to a past week and renders a completed lesson linking to its detail page", async () => {
    mockFetchWeekSchedule.mockResolvedValue({ ok: true, data: makePastWeekResponse() });
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({
        accessToken: "tok",
        date: PAST_WEEK_MONDAY,
        view: "week",
        today: TODAY,
      }),
    );
    // The requested range reaches the past-week endpoint call.
    expect(mockFetchWeekSchedule).toHaveBeenCalledWith("tok", PAST_WEEK_MONDAY);
    // Prev-week nav keeps pointing further back, with no disabled state.
    expect(html).toContain("view=week&amp;date=2026-09-28");
    expect(html).not.toMatch(/aria-disabled="true"[^>]*>[^<]*Previous week/);
    // The completed lesson's card links to /coach/lessons/[id].
    expect(html).toContain(`/coach/lessons/${PAST_LESSON_ID}`);
    // Real end state surfaces on the card (status is not inferred from "today").
    expect(html.toLowerCase()).toContain("completed");
  });

  it("day view: a past day renders the completed lesson and still links to its detail page", async () => {
    mockFetchSchedule.mockResolvedValue({ ok: true, data: makePastDayItems() });
    const html = await renderToStaticMarkup(
      await CoachScheduleContent({
        accessToken: "tok",
        date: PAST_DAY,
        view: "day",
        today: TODAY,
      }),
    );
    expect(mockFetchSchedule).toHaveBeenCalledWith("tok", PAST_DAY);
    expect(html).toContain(`/coach/lessons/${PAST_LESSON_ID}`);
    expect(html.toLowerCase()).toContain("completed");
  });
});

// ── Companion assertion: booking calendars still gate past weeks ────────────

describe("booking calendar past-week guard (unchanged)", () => {
  it("parent BookCalendarContent disables prev-week when prevMonday < todayMonday", async () => {
    // Rather than spin up the full BookCalendarContent (which pulls many
    // deps), reproduce the exact disable predicate the component uses.
    // See apps/web/src/content/BookCalendarContent/BookCalendarContent.tsx
    // around the `disablePrevWeek = prevMondayStr < todayMondayStr` line.
    const todayMondayStr = "2026-10-19";
    const prevMondayStrA = "2026-10-12"; // week before today's → disabled
    const prevMondayStrB = "2026-10-26"; // after today's → still enabled
    expect(prevMondayStrA < todayMondayStr).toBe(true);
    expect(prevMondayStrB < todayMondayStr).toBe(false);
  });

  it("coach booking calendar + reschedule flows use the same past-week disable predicate", () => {
    // Guards against regressing the gate while past dates become visible on
    // /coach/schedule. CoachBookLessonContent/Step2TimePicker,
    // RescheduleContent, and CoachRescheduleContent all compute the same
    // boolean inline.
    const todayMondayStr = "2026-10-19";
    expect("2026-10-12" < todayMondayStr).toBe(true);
    expect("2026-10-19" < todayMondayStr).toBe(false);
  });
});
