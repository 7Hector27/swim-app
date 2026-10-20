import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/AddNoteForm", () => ({
  default: () => <form data-testid="add-note-form" />,
}));
vi.mock("@/components/ConfirmDialog", () => ({
  default: () => <div data-testid="confirm-dialog" />,
}));
vi.mock("@/components/LessonStatusBadge", () => ({
  default: () => null,
}));
vi.mock("../content/CoachLessonDetailContent/actions", () => ({
  cancelCoachLessonAction: vi.fn(),
  approveCoachLessonAction: vi.fn(),
  declineCoachLessonAction: vi.fn(),
}));

import CoachLessonDetailContent from "../content/CoachLessonDetailContent/CoachLessonDetailContent";
import type { CoachLessonDetail, CoachNoteResponse } from "@swim-app/shared";

const LESSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SWIMMER_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const COACH_ID = "cccccccc-0000-0000-0000-000000000003";

const lesson: CoachLessonDetail = {
  id: LESSON_ID,
  householdId: "dddddddd-0000-0000-0000-000000000004",
  householdName: "Smith Family",
  locationId: "eeeeeeee-0000-0000-0000-000000000005",
  locationName: "Egret Park",
  locationAddress: "45 Ovation",
  locationCity: "Irvine",
  locationState: "CA",
  locationZip: "92620",
  isHomePool: false,
  startsAt: "2099-06-01T17:00:00.000Z",
  durationMinutes: 30,
  type: "private",
  status: "approved",
  swimmers: [
    { swimmerId: SWIMMER_ID, firstName: "Morgan", lastName: "Lee", clubName: null },
  ],
  expiresAt: null,
  approvedAt: "2099-05-30T10:00:00.000Z",
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2099-05-29T10:00:00.000Z",
};

const note: CoachNoteResponse = {
  id: "ffffffff-0000-0000-0000-000000000001",
  swimmerId: SWIMMER_ID,
  sessionId: null,
  lessonId: LESSON_ID,
  body: "Great kick today",
  createdBy: COACH_ID,
  createdAt: "2099-06-01T18:00:00.000Z",
  updatedAt: "2099-06-01T18:00:00.000Z",
};

const olderNote: CoachNoteResponse = {
  ...note,
  id: "ffffffff-0000-0000-0000-000000000002",
  body: "Needs work on breathing",
  createdAt: "2099-05-31T18:00:00.000Z",
  updatedAt: "2099-05-31T18:00:00.000Z",
};

describe("CoachLessonDetailContent — existing notes", () => {
  it("shows existing note body above the add form", () => {
    render(<CoachLessonDetailContent lesson={lesson} notes={[note]} />);
    expect(screen.getByText("Great kick today")).toBeInTheDocument();
    expect(screen.getByTestId("add-note-form")).toBeInTheDocument();
  });

  it("lists multiple notes newest first", () => {
    render(<CoachLessonDetailContent lesson={lesson} notes={[note, olderNote]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Great kick today");
    expect(items[1]).toHaveTextContent("Needs work on breathing");
  });

  it("shows no note list when notes array is empty", () => {
    render(<CoachLessonDetailContent lesson={lesson} notes={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByTestId("add-note-form")).toBeInTheDocument();
  });

  it("only shows notes for the matching swimmer, not other swimmers", () => {
    const otherSwimmerId = "99999999-0000-0000-0000-000000000099";
    const noteForOtherSwimmer: CoachNoteResponse = {
      ...note,
      id: "ffffffff-0000-0000-0000-000000000003",
      swimmerId: otherSwimmerId,
      body: "Should not appear",
    };
    render(<CoachLessonDetailContent lesson={lesson} notes={[note, noteForOtherSwimmer]} />);
    expect(screen.getByText("Great kick today")).toBeInTheDocument();
    expect(screen.queryByText("Should not appear")).toBeNull();
  });
});
