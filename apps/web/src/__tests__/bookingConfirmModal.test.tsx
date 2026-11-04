import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// jsdom doesn't implement HTMLDialogElement methods
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.clearAllMocks();
});

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/dashboard",
}));

import BookingConfirmDialog from "../content/ParentDashboardContent/BookingConfirmDialog";

const baseLesson = {
  id: "lesson-123",
  locationId: "loc-1",
  locationName: "Sunset Pool",
  startsAt: "2026-06-15T18:00:00-07:00",
  durationMinutes: 45 as const,
  type: "private" as const,
  status: "approved" as const,
  swimmers: [
    { swimmerId: "s-1", firstName: "Maya", lastName: "Smith" },
    { swimmerId: "s-2", firstName: "Kai", lastName: "Smith" },
  ],
  expiresAt: null,
  approvedAt: "2026-06-10T10:00:00-07:00",
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2026-06-10T09:00:00-07:00",
  batchId: null,
  batchMode: null,
};

describe("BookingConfirmDialog", () => {
  it("calls showModal on mount", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  });

  it("shows Confirmed status for approved lesson", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("You are all set!")).toBeInTheDocument();
  });

  it("shows Pending status for pending lesson", () => {
    const lesson = { ...baseLesson, status: "pending" as const };
    render(<BookingConfirmDialog lesson={lesson} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Request sent")).toBeInTheDocument();
    expect(screen.getByText(/Jason will confirm/)).toBeInTheDocument();
  });

  it("shows duration, pool name, and swimmer names", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(screen.getByText("Sunset Pool")).toBeInTheDocument();
    expect(screen.getByText("Maya Smith, Kai Smith")).toBeInTheDocument();
  });

  it("Done button closes dialog and replaces URL", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    fireEvent.click(screen.getByRole("button", { name: "Done", hidden: true }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("View lesson button navigates to lesson detail", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    fireEvent.click(screen.getByRole("button", { name: "View lesson", hidden: true }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/lessons/lesson-123");
  });
});

// Generic variant: rendered when the booking succeeded but the follow-up
// details fetch failed. The parent still gets confirmation so they don't
// re-submit thinking the booking failed.
describe("BookingConfirmDialog — generic (details fetch failed)", () => {
  it("renders 'Your booking request was sent' with no lesson details and no View lesson button", () => {
    render(<BookingConfirmDialog />);
    expect(screen.getByText("Your booking request was sent.")).toBeInTheDocument();
    expect(screen.getByText("Request sent")).toBeInTheDocument();
    expect(screen.getByTestId("booking-confirm-generic-body")).toBeInTheDocument();
    // Must not claim Pending/Confirmed — we can't substantiate that.
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.queryByText("Confirmed")).toBeNull();
    // Details rows (duration / pool / swimmers) are omitted.
    expect(screen.queryByText("Sunset Pool")).toBeNull();
    expect(screen.queryByText("Maya Smith, Kai Smith")).toBeNull();
    // View lesson is suppressed because we don't want to send them into a
    // detail page that may still be failing.
    expect(screen.queryByRole("button", { name: "View lesson", hidden: true })).toBeNull();
    // Done remains.
    expect(screen.getByRole("button", { name: "Done", hidden: true })).toBeInTheDocument();
  });

  it("renders 'Your reschedule request was sent' when movedFrom is set and no lesson", () => {
    render(<BookingConfirmDialog movedFrom="2026-06-15T18:00:00-07:00" />);
    expect(screen.getByText("Your reschedule request was sent.")).toBeInTheDocument();
    expect(screen.getByText("Rescheduled")).toBeInTheDocument();
    // Must not render the "From/To" detail rows since we have no new startsAt.
    expect(screen.queryByText("From")).toBeNull();
    expect(screen.queryByText("To")).toBeNull();
  });

  it("Done still dismisses in the generic variant", () => {
    render(<BookingConfirmDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Done", hidden: true }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });
});

// Clearing ?booked= / ?rescheduled= on dismiss matters because without it a
// refresh would re-trigger the server fetch and re-open the dialog — the
// parent's expected mental model is "I clicked Done, it's gone."
describe("BookingConfirmDialog — dismiss clears URL params", () => {
  it("Done replaces the URL with /dashboard (no query) in the detail variant", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    fireEvent.click(screen.getByRole("button", { name: "Done", hidden: true }));
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    const target = mockReplace.mock.calls[0]?.[0] as string;
    expect(target).not.toMatch(/[?&]booked=/);
    expect(target).not.toMatch(/[?&]rescheduled=/);
    expect(target).not.toMatch(/[?&]from=/);
  });

  it("Done also clears the ?rescheduled= + ?from= params (reschedule variant)", () => {
    // The reschedule URL carries two params (rescheduled=<id>&from=<iso>).
    // Done must drop both so a refresh doesn't re-open the dialog.
    render(
      <BookingConfirmDialog
        lesson={baseLesson}
        movedFrom="2026-06-15T18:00:00-07:00"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Done", hidden: true }));
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    const target = mockReplace.mock.calls[0]?.[0] as string;
    expect(target).not.toMatch(/rescheduled=/);
    expect(target).not.toMatch(/from=/);
  });

  it("Escape (dialog cancel) also clears the params", () => {
    render(<BookingConfirmDialog lesson={baseLesson} />);
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    // HTMLDialogElement's native close-on-Escape fires a 'cancel' event; the
    // component wires dismiss() to that.
    const cancelEvent = new Event("cancel", { cancelable: true });
    dialog!.dispatchEvent(cancelEvent);
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });
});
