import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/notes", () => ({
  createNoteAction: vi.fn(),
}));

vi.mock("@/content/BookCalendarContent/actions", () => ({
  fetchSlotsDirectAction: vi.fn(),
}));

vi.mock("../content/LessonDetailContent/actions", () => ({
  cancelLessonAction: vi.fn(),
  rescheduleLessonAction: vi.fn(),
}));

vi.mock("@/components/SiteFooter", () => ({ default: () => <footer /> }));
vi.mock("@/components/ConfirmDialog", () => ({
  default: () => <div data-testid="confirm-dialog" />,
}));
vi.mock("@/components/AddNoteForm", () => ({
  default: () => <form data-testid="add-note-form" />,
}));

import LessonDetailContent from "../content/LessonDetailContent/LessonDetailContent";
import type { UpcomingLesson, LessonLocation } from "@swim-app/shared";

const LESSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SWIMMER_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const LOCATION_ID = "cccccccc-0000-0000-0000-000000000003";

const lesson: UpcomingLesson = {
  id: LESSON_ID,
  locationId: LOCATION_ID,
  locationName: "Egret Park",
  startsAt: "2025-06-01T15:00:00.000Z",
  durationMinutes: 30,
  type: "private",
  status: "approved",
  swimmers: [{ swimmerId: SWIMMER_ID, firstName: "Alex", lastName: "Smith" }],
  expiresAt: null,
  approvedAt: "2025-05-30T10:00:00.000Z",
  declinedAt: null,
  declineReason: null,
  createdAt: "2025-05-29T10:00:00.000Z",
};

const locations: LessonLocation[] = [];

describe("LessonDetailContent — isCoach guard", () => {
  it("does not render note forms when isCoach is false", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.queryByTestId("add-note-form")).toBeNull();
    expect(screen.queryByText("Lesson notes")).toBeNull();
  });

  it("renders note forms when isCoach is true", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={true} />,
    );
    expect(screen.getByTestId("add-note-form")).toBeInTheDocument();
    expect(screen.getByText("Lesson notes")).toBeInTheDocument();
  });
});
