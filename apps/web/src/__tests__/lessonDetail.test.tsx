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
import type { LessonLocation, UpcomingLesson } from "@swim-app/shared";

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

const locations: LessonLocation[] = [
  {
    id: LOCATION_ID,
    name: "Egret Park",
    address: "123 Palm Street",
    city: "Palos Verdes",
    state: "CA",
    zip: "90274",
    isHomePool: true,
    isActive: true,
    sortOrder: 0,
  },
];

describe("LessonDetailContent — action visibility", () => {
  it("renders Reschedule and Cancel actions for a future lesson", () => {
    const futureLesson: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureLesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.getByRole("link", { name: "Reschedule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel this lesson/i })).toBeInTheDocument();
  });

  it("hides Reschedule and Cancel for a past lesson", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.queryByRole("link", { name: "Reschedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel this lesson/i })).toBeNull();
  });

  it("hides Reschedule and Cancel for viewers", () => {
    const futureLesson: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureLesson} locations={locations} isViewer={true} isCoach={false} />,
    );
    expect(screen.queryByRole("link", { name: "Reschedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel this lesson/i })).toBeNull();
  });

  it("shows the viewer-friendly note when a viewer opens a future lesson", () => {
    const futureLesson: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureLesson} locations={locations} isViewer={true} isCoach={false} />,
    );
    expect(screen.getByText(/view this lesson but not change it/i)).toBeInTheDocument();
  });

  it("shows the past-lesson note when the lesson has already started", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.getByText(/this lesson has ended/i)).toBeInTheDocument();
  });
});

describe("LessonDetailContent — rescheduled badge", () => {
  it("shows the Rescheduled row when movedAt and previousStartsAt are set", () => {
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

  it("does not show the Rescheduled row when movedAt is null", () => {
    render(
      <LessonDetailContent lesson={lesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.queryByText(/Moved by Jason/)).toBeNull();
  });
});

describe("LessonDetailContent — cancel remaining in batch", () => {
  const batchLesson: UpcomingLesson = {
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
        lesson={batchLesson}
        locations={locations}
        isViewer={false}
        isCoach={false}
        batchSiblings={[batchLesson, sibling]}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel remaining lessons/i })).toBeInTheDocument();
  });

  it("hides the Cancel remaining lessons action when the lesson has no batch siblings", () => {
    render(
      <LessonDetailContent
        lesson={batchLesson}
        locations={locations}
        isViewer={false}
        isCoach={false}
        batchSiblings={[batchLesson]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel remaining lessons/i })).toBeNull();
  });

  it("hides the Cancel remaining lessons action for viewers", () => {
    render(
      <LessonDetailContent
        lesson={batchLesson}
        locations={locations}
        isViewer={true}
        isCoach={false}
        batchSiblings={[batchLesson, sibling]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel remaining lessons/i })).toBeNull();
  });

  it("renders the Upcoming in this booking list with other siblings only", () => {
    render(
      <LessonDetailContent
        lesson={batchLesson}
        locations={locations}
        isViewer={false}
        isCoach={false}
        batchSiblings={[batchLesson, sibling]}
      />,
    );
    expect(screen.getByText("Upcoming in this booking")).toBeInTheDocument();
    expect(screen.getByText("1 lesson")).toBeInTheDocument();
  });

  it("hides the Upcoming in this booking list for a non-batch lesson", () => {
    const futureNonBatch: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureNonBatch} locations={locations} isViewer={false} isCoach={false} />,
    );
    expect(screen.queryByText("Upcoming in this booking")).toBeNull();
  });
});

describe("LessonDetailContent — map link", () => {
  it("renders the map link with the full pool address when the location is known", () => {
    const futureLesson: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureLesson} locations={locations} isViewer={false} isCoach={false} />,
    );
    const link = screen.getByRole("link", {
      name: /123 Palm Street, Palos Verdes, CA 90274/,
    });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=123%20Palm%20Street%2C%20Palos%20Verdes%2C%20CA%2090274",
    );
  });

  it("falls back to the pool name when the location is not in the locations list", () => {
    const futureLesson: UpcomingLesson = { ...lesson, startsAt: "2099-01-01T00:00:00.000Z" };
    render(
      <LessonDetailContent lesson={futureLesson} locations={[]} isViewer={false} isCoach={false} />,
    );
    const link = screen.getByRole("link", { name: /Open in Maps/ });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Egret%20Park",
    );
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
