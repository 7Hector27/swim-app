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
  createdAt: "2026-06-10T09:00:00-07:00",
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
