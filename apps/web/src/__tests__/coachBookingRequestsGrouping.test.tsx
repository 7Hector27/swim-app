// Verifies the coach pending card groups same-batch lessons into one entry
// with an "Approve all" button, and expands to show individual lessons.
// See ADR 030 Phase 3.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LessonResponse } from "@swim-app/shared";

const approveBatchCalls: string[] = [];

vi.mock("@/components/CoachLessonRow/actions", () => ({
  approveBatchPendingAction: vi.fn(async (batchId: string) => {
    approveBatchCalls.push(batchId);
    return { status: "success" } as const;
  }),
  approveLessonAction: vi.fn(async () => ({ status: "idle" }) as const),
  declineLessonAction: vi.fn(async () => ({ status: "idle" }) as const),
}));

import BookingRequestsCard from "../content/CoachDashboardContent/BookingRequestsCard";

function makeLesson(overrides: Partial<LessonResponse>): LessonResponse {
  return {
    id: "lesson-id",
    householdId: "household-id",
    locationId: "loc-id",
    startsAt: "2035-11-15T20:30:00.000Z",
    durationMinutes: 30,
    type: "private",
    status: "pending",
    swimmers: [
      { swimmerId: "s1", firstName: "Alex", lastName: "Carbajal" },
    ],
    expiresAt: null,
    approvedAt: null,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: "2035-11-01T00:00:00.000Z",
    batchId: null,
    batchMode: null,
    ...overrides,
  };
}

beforeEach(() => {
  approveBatchCalls.length = 0;
});

describe("BookingRequestsCard — batch grouping (Phase 3)", () => {
  it("groups same-batch pending lessons into one card with an Approve all button", () => {
    const batchId = "11111111-1111-1111-1111-111111111111";
    const lessons: LessonResponse[] = [
      makeLesson({
        id: "l1",
        batchId,
        batchMode: "weekly",
        startsAt: "2035-11-18T20:30:00.000Z",
      }),
      makeLesson({
        id: "l2",
        batchId,
        batchMode: "weekly",
        startsAt: "2035-11-25T20:30:00.000Z",
      }),
      makeLesson({
        id: "l3",
        batchId,
        batchMode: "weekly",
        startsAt: "2035-12-02T20:30:00.000Z",
      }),
    ];

    render(<BookingRequestsCard initialLessons={lessons} />);

    // Only ONE Approve all button for the batch of 3.
    const approveAllButtons = screen.getAllByRole("button", { name: /approve all/i });
    expect(approveAllButtons).toHaveLength(1);

    // Collapsed by default: the toggle button says "Show N lessons" and the
    // <details> wrapper that holds the per-lesson rows is not open.
    const toggle = screen.getByRole("button", { name: /show 3 lessons/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel?.tagName.toLowerCase()).toBe("details");
    expect(panel?.hasAttribute("open")).toBe(false);

    // Expand the batch.
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /hide lessons/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(panel?.hasAttribute("open")).toBe(true);

    // Three per-lesson Approve + Decline buttons appear after expansion.
    const perLessonApprove = screen.getAllByRole("button", { name: /^approve$/i });
    expect(perLessonApprove).toHaveLength(3);
    const perLessonDecline = screen.getAllByRole("button", { name: /^decline$/i });
    expect(perLessonDecline).toHaveLength(3);
  });

  it("Approve all button triggers approveBatchPendingAction with the batch id", async () => {
    const batchId = "22222222-2222-2222-2222-222222222222";
    const lessons: LessonResponse[] = [
      makeLesson({
        id: "l1",
        batchId,
        batchMode: "weekly",
        startsAt: "2035-11-18T20:30:00.000Z",
      }),
      makeLesson({
        id: "l2",
        batchId,
        batchMode: "weekly",
        startsAt: "2035-11-25T20:30:00.000Z",
      }),
    ];

    render(<BookingRequestsCard initialLessons={lessons} />);

    const approveAll = screen.getByRole("button", { name: /approve all/i });
    fireEvent.click(approveAll);

    // The server action is wired to the form submit; use the form's submit
    // via the button inside its form.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(approveBatchCalls).toContain(batchId);
  });

  it("renders solo (non-batch) pending lessons without the Approve all control", () => {
    const lessons: LessonResponse[] = [makeLesson({ id: "l1" })];
    render(<BookingRequestsCard initialLessons={lessons} />);
    expect(screen.queryByRole("button", { name: /approve all/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
  });
});
