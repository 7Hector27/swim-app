import { vi, describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { mockUnread, mockList, mockReadAll, mockMarkRead, mockPush } = vi.hoisted(() => ({
  mockUnread: vi.fn(),
  mockList: vi.fn(),
  mockReadAll: vi.fn(),
  mockMarkRead: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/lib/api/coachAlerts", () => ({
  fetchUnreadCount: mockUnread,
  fetchNotifications: mockList,
  markAllNotificationsRead: mockReadAll,
  markNotificationRead: mockMarkRead,
  COACH_NOTIFICATIONS_CHANGED_EVENT: "coach-notifications:changed",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: mockPush }),
}));

import CoachNotificationBell from "../components/CoachNotificationBell/CoachNotificationBell";

beforeEach(() => {
  vi.clearAllMocks();
  mockUnread.mockResolvedValue({ ok: true, data: { count: 0 } });
  mockList.mockResolvedValue({ ok: true, data: { items: [], unreadCount: 0 } });
  mockReadAll.mockResolvedValue({ ok: true, status: 204 });
  mockMarkRead.mockResolvedValue({ ok: true, status: 204 });
});

// Both the desktop dropdown (role="menu" aria-label="Notifications")
// and the mobile sheet (role="dialog" aria-label="Notifications") render
// into the DOM when open; CSS media queries pick one. Scope assertions
// to the dropdown so each item is matched once.
function panelContent() {
  return within(screen.getByRole("menu", { name: "Notifications" }));
}

describe("CoachNotificationBell", () => {
  it("renders without a badge when the unread count is zero", async () => {
    render(<CoachNotificationBell />);
    await waitFor(() => expect(mockUnread).toHaveBeenCalled());
    const trigger = screen.getByRole("button", { name: /notifications/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Badge is aria-hidden so the accessible label carries the count. With
    // 0 unread, the label omits the count entirely.
    expect(trigger).toHaveAccessibleName("Notifications");
  });

  it("shows the badge count when there are unread notifications", async () => {
    mockUnread.mockResolvedValue({ ok: true, data: { count: 3 } });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: /3 unread/i }),
    ).toBeInTheDocument();
  });

  it("caps the badge at 9+", async () => {
    mockUnread.mockResolvedValue({ ok: true, data: { count: 42 } });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(screen.getByText("9+")).toBeInTheDocument());
  });

  it("opens the panel and lists notifications", async () => {
    mockUnread.mockResolvedValue({ ok: true, data: { count: 1 } });
    mockList.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "n1",
            category: "booking_request",
            urgency: "urgent",
            title: "New booking request",
            body: "Alex R., Tue 4:30 PM at Egret Park",
            clickUrl: "/coach/lessons/l1",
            createdAt: new Date().toISOString(),
            readAt: null,
            lessonId: "l1",
            batchId: null,
            scrubbed: false,
          },
        ],
        unreadCount: 1,
      },
    });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /1 unread/i }));
    await waitFor(() =>
      expect(panelContent().getByText("New booking request")).toBeInTheDocument(),
    );
  });

  it("marks a notification read on click and routes to its URL", async () => {
    mockUnread.mockResolvedValue({ ok: true, data: { count: 1 } });
    mockList.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "n1",
            category: "booking_request",
            urgency: "standard",
            title: "New booking request",
            body: "A swimmer, Tue 4:30 PM at Egret Park",
            clickUrl: "/coach/lessons/l1",
            createdAt: new Date().toISOString(),
            readAt: null,
            lessonId: "l1",
            batchId: null,
            scrubbed: false,
          },
        ],
        unreadCount: 1,
      },
    });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(panelContent().getByText("New booking request")).toBeInTheDocument(),
    );

    fireEvent.click(panelContent().getByText("New booking request"));
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith("n1");
      expect(mockPush).toHaveBeenCalledWith("/coach/lessons/l1");
    });
  });

  it("mark-all-as-read clears the badge count", async () => {
    mockUnread.mockResolvedValue({ ok: true, data: { count: 2 } });
    mockList.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "n1",
            category: "booking_request",
            urgency: "standard",
            title: "T1",
            body: "B1",
            clickUrl: "/coach/lessons/l1",
            createdAt: new Date().toISOString(),
            readAt: null,
            lessonId: "l1",
            batchId: null,
            scrubbed: false,
          },
        ],
        unreadCount: 2,
      },
    });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() => expect(panelContent().getByText("T1")).toBeInTheDocument());
    // Two "Mark all as read" buttons render (one per surface); grab the
    // one inside the dropdown.
    fireEvent.click(panelContent().getByRole("button", { name: /mark all as read/i }));
    await waitFor(() => {
      expect(mockReadAll).toHaveBeenCalled();
      // Badge gone.
      expect(screen.queryByText("2")).not.toBeInTheDocument();
    });
  });

  it("refreshes the badge immediately when another screen fires the changed event", async () => {
    // Start with 3 unread; a different screen marks all read and dispatches
    // COACH_NOTIFICATIONS_CHANGED_EVENT. The bell must requery and show 0
    // without waiting for the 60-second poll.
    mockUnread.mockResolvedValueOnce({ ok: true, data: { count: 3 } });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());

    mockUnread.mockResolvedValueOnce({ ok: true, data: { count: 0 } });
    await act(async () => {
      window.dispatchEvent(new Event("coach-notifications:changed"));
    });
    await waitFor(() => expect(screen.queryByText("3")).not.toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
  });

  it("renders scrubbed rows as disabled with the clickUrl neutralized", async () => {
    mockUnread.mockResolvedValue({ ok: true, data: { count: 0 } });
    mockList.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "n1",
            category: "booking_request",
            urgency: "standard",
            title: "Booking request",
            body: "No longer available · 2026-09-01",
            clickUrl: "",
            createdAt: "2026-09-01T10:00:00Z",
            readAt: null,
            lessonId: null,
            batchId: null,
            scrubbed: true,
          },
        ],
        unreadCount: 0,
      },
    });
    render(<CoachNotificationBell />);
    await waitFor(() => expect(mockUnread).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() =>
      expect(panelContent().getByText(/No longer available/)).toBeInTheDocument(),
    );
    const row = panelContent().getByRole("menuitem", { name: /booking request/i });
    expect(row).toBeDisabled();
  });
});
