import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import type { CoachNotificationListItem } from "@swim-app/shared";

const { mockList, mockReadAll, mockMarkRead, mockPush } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockReadAll: vi.fn(),
  mockMarkRead: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/lib/api/coachAlerts", () => ({
  fetchNotifications: mockList,
  markAllNotificationsRead: mockReadAll,
  markNotificationRead: mockMarkRead,
  COACH_NOTIFICATIONS_CHANGED_EVENT: "coach-notifications:changed",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import CoachNotificationsContent from "../content/CoachNotificationsContent/CoachNotificationsContent";

// Setup pins the clock to Monday 2026-10-26 at 17:00 UTC = 10:00 LA, so
// the following LA dates are stable for the groupNotificationsByDate
// buckets:
//   today     = 2026-10-26 (Mon)
//   yesterday = 2026-10-25 (Sun) - note this is BEFORE Monday-of-today
//   this week = 2026-10-26 .. (none-else, since Monday is today)
//   earlier   = anything older than 2026-10-26
// For a more exercise-friendly bucket layout we move the frozen clock
// per-test when we need Yesterday + This week to both have members.

function makeItem(partial: Partial<CoachNotificationListItem> & Pick<CoachNotificationListItem, "id" | "createdAt">): CoachNotificationListItem {
  return {
    id: partial.id,
    category: partial.category ?? "booking_request",
    urgency: partial.urgency ?? "standard",
    title: partial.title ?? `Title ${partial.id}`,
    body: partial.body ?? `Body ${partial.id}`,
    clickUrl: partial.clickUrl ?? `/coach/lessons/${partial.id}`,
    createdAt: partial.createdAt,
    readAt: partial.readAt ?? null,
    lessonId: partial.lessonId ?? null,
    batchId: partial.batchId ?? null,
    scrubbed: partial.scrubbed ?? false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAll.mockResolvedValue({ ok: true, status: 204 });
  mockMarkRead.mockResolvedValue({ ok: true, status: 204 });
});

describe("CoachNotificationsContent - grouping", () => {
  it("groups items into Today / Yesterday / This week / Earlier", async () => {
    // Frozen clock from setup is 2026-10-26T17:00:00Z (Monday 10:00 LA).
    // Move it to 2026-10-29T17:00:00Z (Thursday 10:00 LA) so Yesterday
    // and This week both have members between them.
    vi.setSystemTime(new Date("2026-10-29T17:00:00.000Z"));
    const items = [
      makeItem({ id: "today-1", createdAt: "2026-10-29T18:00:00.000Z" }), // Thu 11am LA = Today
      makeItem({ id: "yest-1", createdAt: "2026-10-28T18:00:00.000Z" }), // Wed 11am LA = Yesterday
      makeItem({ id: "week-1", createdAt: "2026-10-26T18:00:00.000Z" }), // Mon 11am LA = This week
      makeItem({ id: "old-1", createdAt: "2026-10-20T18:00:00.000Z" }), // prev week = Earlier
    ];
    mockList.mockResolvedValue({
      ok: true,
      data: { items, unreadCount: 4, hasMore: false },
    });
    render(<CoachNotificationsContent />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Today/)).toBeInTheDocument());

    // Each group heading has an aria-labelledby matching its section;
    // scope assertions to the section with that heading so we don't
    // accidentally match page-level copy.
    const todaySection = screen.getByRole("region", { name: "Today" });
    expect(within(todaySection).getByText("Title today-1")).toBeInTheDocument();

    const yesterdaySection = screen.getByRole("region", { name: "Yesterday" });
    expect(within(yesterdaySection).getByText("Title yest-1")).toBeInTheDocument();

    const thisWeekSection = screen.getByRole("region", { name: "This week" });
    expect(within(thisWeekSection).getByText("Title week-1")).toBeInTheDocument();

    const earlierSection = screen.getByRole("region", { name: "Earlier" });
    expect(within(earlierSection).getByText("Title old-1")).toBeInTheDocument();
  });

  it("omits groups that would be empty", async () => {
    vi.setSystemTime(new Date("2026-10-29T17:00:00.000Z"));
    const items = [
      makeItem({ id: "today-1", createdAt: "2026-10-29T18:00:00.000Z" }),
    ];
    mockList.mockResolvedValue({
      ok: true,
      data: { items, unreadCount: 1, hasMore: false },
    });
    render(<CoachNotificationsContent />);
    await waitFor(() => expect(screen.getByText(/Today/)).toBeInTheDocument());
    expect(screen.queryByText("Yesterday")).not.toBeInTheDocument();
    expect(screen.queryByText("This week")).not.toBeInTheDocument();
    expect(screen.queryByText("Earlier")).not.toBeInTheDocument();
  });
});

describe("CoachNotificationsContent - Load more", () => {
  it("renders Load more when hasMore=true and appends the next page on click", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      makeItem({
        id: `n-${index}`,
        createdAt: new Date(Date.now() - index * 60_000).toISOString(),
      }),
    );
    mockList.mockResolvedValueOnce({
      ok: true,
      data: { items: firstPage, unreadCount: 20, hasMore: true },
    });

    render(<CoachNotificationsContent />);
    await waitFor(() => expect(screen.getByText("Title n-0")).toBeInTheDocument());

    const loadMore = screen.getByRole("button", { name: /load more/i });
    expect(loadMore).toBeInTheDocument();

    const secondPage = [
      makeItem({
        id: "n-20",
        createdAt: new Date(Date.now() - 21 * 60_000).toISOString(),
      }),
    ];
    mockList.mockResolvedValueOnce({
      ok: true,
      data: { items: secondPage, unreadCount: 20, hasMore: false },
    });

    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.getByText("Title n-20")).toBeInTheDocument());
    // Second fetch requested offset=20.
    expect(mockList).toHaveBeenCalledWith({
      order: "chronological",
      offset: 20,
      limit: 20,
    });
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("does not render Load more when hasMore=false", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: {
        items: [makeItem({ id: "only", createdAt: new Date().toISOString() })],
        unreadCount: 0,
        hasMore: false,
      },
    });
    render(<CoachNotificationsContent />);
    await waitFor(() => expect(screen.getByText("Title only")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});

describe("CoachNotificationsContent - destinations", () => {
  // Each row's clickUrl comes from the API (built in outbox.ts); the page's
  // job is to route the browser there and mark the row read. These tests
  // confirm the per-category URLs round-trip correctly.
  const CASES: Array<[string, string]> = [
    // New request / cancellation / reschedule / expiring / auto-approved
    // for a single lesson all route to that lesson's coach page.
    ["booking_request lesson", "/coach/lessons/l1"],
    ["request_expiring_soon", "/coach/lessons/l2"],
    ["parent_change lesson canceled", "/coach/lessons/l3"],
    ["parent_change lesson rescheduled", "/coach/lessons/l4"],
    ["auto_approved_summary", "/coach/lessons/l5"],
    // Batch request → dashboard with batch param.
    ["booking_request batch", "/dashboard?batch=b1"],
    // Batch cancel-remaining → schedule week view at first canceled date.
    ["parent_change batch", "/coach/schedule?view=week&date=2026-11-02"],
    // Calendar disconnected → account.
    ["calendar_disconnected", "/account"],
    // Daily summary → coach schedule (defaults to today).
    ["daily_summary", "/coach/schedule"],
  ];

  for (const [label, url] of CASES) {
    it(`routes a ${label} notification to ${url}`, async () => {
      mockList.mockResolvedValue({
        ok: true,
        data: {
          items: [
            makeItem({
              id: `${label}-id`,
              createdAt: new Date().toISOString(),
              clickUrl: url,
              title: `Click me ${label}`,
            }),
          ],
          unreadCount: 1,
          hasMore: false,
        },
      });
      render(<CoachNotificationsContent />);
      await waitFor(() =>
        expect(screen.getByText(`Click me ${label}`)).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByText(`Click me ${label}`));
      await waitFor(() => {
        expect(mockMarkRead).toHaveBeenCalledWith(`${label}-id`);
        expect(mockPush).toHaveBeenCalledWith(url);
      });
    });
  }

  it("fallback: a scrubbed row (target gone) does not navigate", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: {
        items: [
          makeItem({
            id: "scrubbed-1",
            createdAt: new Date().toISOString(),
            clickUrl: "",
            scrubbed: true,
            title: "Scrubbed row",
            body: "No longer available",
          }),
        ],
        unreadCount: 0,
        hasMore: false,
      },
    });
    render(<CoachNotificationsContent />);
    await waitFor(() => expect(screen.getByText("Scrubbed row")).toBeInTheDocument());
    const button = screen
      .getByText("Scrubbed row")
      .closest("button") as HTMLButtonElement;
    expect(button).toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
