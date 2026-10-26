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
  findFirstAvailableDayAction: vi.fn().mockResolvedValue({ firstAvailableDate: null }),
}));

vi.mock("../content/LessonDetailContent/actions", () => ({
  cancelLessonAction: vi.fn(),
  cancelBatchRemainingAction: vi.fn(),
  rescheduleLessonAction: vi.fn(),
}));

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
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2025-05-29T10:00:00.000Z",
  batchId: null,
  batchMode: null,
};

const locations: LessonLocation[] = [];

describe("LessonDetailContent — started lesson guard", () => {
  it("shows Reschedule and Cancel headings for a future lesson", () => {
    const futureLesson: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureLesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.getByText("Reschedule")).toBeInTheDocument();
    expect(screen.getByText("Cancel lesson")).toBeInTheDocument();
  });

  it("hides Reschedule and Cancel for a started lesson", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.queryByText("Cancel lesson")).toBeNull();
  });
});

describe("LessonDetailContent — Moved by Jason", () => {
  it("shows 'Moved by Jason' row when movedAt and previousStartsAt are set", () => {
    const movedLesson: UpcomingLesson = {
      ...lesson,
      startsAt: "2099-01-02T17:00:00.000Z",
      movedAt: "2099-01-01T12:00:00.000Z",
      previousStartsAt: "2099-01-01T15:00:00.000Z",
    };
    render(
      <LessonDetailContent lesson={movedLesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.getByText(/Moved by Jason/)).toBeInTheDocument();
  });

  it("does not show 'Moved by Jason' when movedAt is null", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.queryByText(/Moved by Jason/)).toBeNull();
  });
});

describe("LessonDetailContent — cancel remaining in batch", () => {
  const futureLesson: UpcomingLesson = {
    ...lesson,
    startsAt: "2099-01-01T00:00:00.000Z",
    batchId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    batchMode: "weekly",
  };
  const sibling: UpcomingLesson = {
    ...lesson,
    id: "aaaaaaaa-0000-0000-0000-000000000099",
    startsAt: "2099-01-08T00:00:00.000Z",
    batchId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    batchMode: "weekly",
  };

  it("renders the Cancel remaining lessons action for a batch lesson with siblings", () => {
    render(
      <LessonDetailContent
        lesson={futureLesson}
        locations={locations}
        isViewer={false}
        isCoach={false}
        batchSiblings={[futureLesson, sibling]}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel remaining lessons/i })).toBeInTheDocument();
  });

  it("hides the Cancel remaining lessons action when the lesson has no batch siblings", () => {
    render(
      <LessonDetailContent
        lesson={futureLesson}
        locations={locations}
        isViewer={false}
        isCoach={false}
        batchSiblings={[futureLesson]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel remaining lessons/i })).toBeNull();
  });

  it("hides the Cancel remaining lessons action for viewers", () => {
    render(
      <LessonDetailContent
        lesson={futureLesson}
        locations={locations}
        isViewer={true}
        isCoach={false}
        batchSiblings={[futureLesson, sibling]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel remaining lessons/i })).toBeNull();
  });
});

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
