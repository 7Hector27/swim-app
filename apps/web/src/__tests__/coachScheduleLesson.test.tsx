import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ConfirmDialog", () => ({
  default: () => <div data-testid="confirm-dialog" />,
}));
vi.mock("@/components/LessonStatusBadge", () => ({
  default: () => null,
}));
vi.mock("@/components/CoachLessonRow/actions", () => ({
  approveLessonAction: vi.fn().mockResolvedValue({ status: "idle" }),
  declineLessonAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

import CoachLessonRow from "@/components/CoachLessonRow";
import type { CoachScheduleLessonItem } from "@swim-app/shared";

const LESSON_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SWIMMER_A_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const SWIMMER_B_ID = "cccccccc-0000-4000-8000-000000000003";
const STARTS_AT = "2025-06-01T17:00:00.000Z"; // 10:00 AM PDT

const privateItem: CoachScheduleLessonItem = {
  type: "lesson",
  householdId: "dddddddd-0000-4000-8000-000000000004",
  locationName: "Egret Park",
  lesson: {
    id: LESSON_ID,
    householdId: "dddddddd-0000-4000-8000-000000000004",
    locationId: "eeeeeeee-0000-4000-8000-000000000005",
    startsAt: STARTS_AT,
    durationMinutes: 30,
    type: "private",
    status: "approved",
    swimmers: [
      { swimmerId: SWIMMER_A_ID, firstName: "Morgan", lastName: "Lee", clubName: null },
    ],
    expiresAt: null,
    approvedAt: STARTS_AT,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: STARTS_AT,
  },
};

const familyItem: CoachScheduleLessonItem = {
  ...privateItem,
  lesson: {
    ...privateItem.lesson,
    type: "family",
    swimmers: [
      { swimmerId: SWIMMER_A_ID, firstName: "Morgan", lastName: "Lee", clubName: "NCAP" },
      { swimmerId: SWIMMER_B_ID, firstName: "Timmy", lastName: "Lee", clubName: "Dolphins SC" },
    ],
  },
};

function renderRow(item: CoachScheduleLessonItem) {
  render(<CoachLessonRow item={item} />);
}

describe("CoachLessonRow — club name on schedule", () => {
  it("shows no club line when swimmer has no club", () => {
    renderRow(privateItem);
    expect(screen.queryByText(/NCAP/)).toBeNull();
  });

  it("shows club name when swimmer has a club", () => {
    const withClub: CoachScheduleLessonItem = {
      ...privateItem,
      lesson: {
        ...privateItem.lesson,
        swimmers: [
          { swimmerId: SWIMMER_A_ID, firstName: "Morgan", lastName: "Lee", clubName: "NCAP" },
        ],
      },
    };
    renderRow(withClub);
    expect(screen.getByText("NCAP")).toBeInTheDocument();
    expect(screen.queryByText(/Morgan \(NCAP\)/)).toBeNull();
    expect(screen.getByText("Morgan")).toBeInTheDocument();
    expect(screen.getByText(/30 min/)).toBeInTheDocument();
  });

  it("shows both club names for a family lesson with different clubs", () => {
    renderRow(familyItem);
    expect(screen.getByText(/NCAP/)).toBeInTheDocument();
    expect(screen.getByText(/Dolphins SC/)).toBeInTheDocument();
  });

  it("does not duplicate a club when two swimmers share the same club", () => {
    const sharedClub: CoachScheduleLessonItem = {
      ...privateItem,
      lesson: {
        ...privateItem.lesson,
        type: "family",
        swimmers: [
          { swimmerId: SWIMMER_A_ID, firstName: "Morgan", lastName: "Lee", clubName: "NCAP" },
          { swimmerId: SWIMMER_B_ID, firstName: "Timmy", lastName: "Lee", clubName: "NCAP" },
        ],
      },
    };
    renderRow(sharedClub);
    const clubEls = screen.getAllByText(/NCAP/);
    expect(clubEls).toHaveLength(1);
  });
});

describe("CoachLessonRow — Evaluate links", () => {
  it("renders an Evaluate link for a private lesson", () => {
    renderRow(privateItem);
    const link = screen.getByRole("link", { name: "Evaluate Morgan" });
    expect(link).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_A_ID}/evaluate`);
  });

  it("renders one Evaluate link per swimmer for a family lesson", () => {
    renderRow(familyItem);
    const morganLink = screen.getByRole("link", { name: "Evaluate Morgan" });
    const timmyLink = screen.getByRole("link", { name: "Evaluate Timmy" });
    expect(morganLink).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_A_ID}/evaluate`);
    expect(timmyLink).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_B_ID}/evaluate`);
  });

  it("hides Evaluate links for a canceled lesson", () => {
    const canceledItem: CoachScheduleLessonItem = {
      ...privateItem,
      lesson: { ...privateItem.lesson, status: "canceled" },
    };
    renderRow(canceledItem);
    expect(screen.queryByRole("link", { name: /Evaluate/ })).toBeNull();
  });

  it("hides Evaluate links for a declined lesson", () => {
    const declinedItem: CoachScheduleLessonItem = {
      ...privateItem,
      lesson: { ...privateItem.lesson, status: "declined", declinedAt: STARTS_AT },
    };
    renderRow(declinedItem);
    expect(screen.queryByRole("link", { name: /Evaluate/ })).toBeNull();
  });

  it("shows Evaluate links for approved, pending, completed, and no_show lessons", () => {
    const statuses = ["approved", "pending", "completed", "no_show"] as const;
    for (const status of statuses) {
      const { unmount } = render(
        <CoachLessonRow item={{ ...privateItem, lesson: { ...privateItem.lesson, status } }} />,
      );
      expect(screen.getByRole("link", { name: "Evaluate Morgan" })).toBeInTheDocument();
      unmount();
    }
  });
});

describe("CoachLessonRow — anonymized (deleted-family) row", () => {
  // Household deletion anonymizes future lessons: swimmers=[], the
  // row flips to status='canceled' and anonymizedAt is set. The day
  // view must show "Deleted family" in place of "No swimmers" and
  // hide Evaluate — same muted state as any cancelled lesson.
  const ANONYMIZED_AT = "2026-05-28T00:00:00.000Z";
  const anonymizedItem: CoachScheduleLessonItem = {
    ...privateItem,
    householdName: "Deleted family",
    locationName: "Home pool",
    lesson: {
      ...privateItem.lesson,
      status: "canceled",
      swimmers: [],
      anonymizedAt: ANONYMIZED_AT,
      locationSnapshot: "Home pool",
      swimmerCount: 1,
    },
  };

  it("renders 'Deleted family' in place of the swimmer list", () => {
    renderRow(anonymizedItem);
    expect(screen.getByText("Deleted family")).toBeInTheDocument();
    expect(screen.queryByText("No swimmers")).toBeNull();
  });

  it("hides Evaluate for an anonymized row", () => {
    renderRow(anonymizedItem);
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
  });

  it("does not show the Approve/Decline buttons for an anonymized pending-looking row", () => {
    // Defensive: anonymized rows are always status='canceled' per the
    // engine, but if one ever slipped through as 'pending', the row
    // must not expose coach actions that would hit a non-existent
    // household.
    renderRow({
      ...anonymizedItem,
      lesson: { ...anonymizedItem.lesson, status: "pending" },
    });
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Decline/ })).toBeNull();
  });

  it("does not render a 'Declined' action-rail label for an anonymized completed row", () => {
    // Regression: the action-rail fallback used to be binary ("Canceled"
    // vs. "Declined"), so an anonymized past-completed row (showEvaluate
    // false because swimmers=[]) rendered the status badge as
    // "Completed" and the action rail as "Declined" at the same time.
    renderRow({
      ...anonymizedItem,
      lesson: { ...anonymizedItem.lesson, status: "completed" },
    });
    expect(screen.queryByText("Declined")).toBeNull();
    // Evaluate is hidden too (anonymized), so the rail area is empty
    // apart from the Open-lesson link on the right.
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
  });

  it("does not render a 'Declined' action-rail label for an anonymized no-show row", () => {
    renderRow({
      ...anonymizedItem,
      lesson: { ...anonymizedItem.lesson, status: "no_show" },
    });
    expect(screen.queryByText("Declined")).toBeNull();
  });
});

describe("CoachLessonRow — Open lesson link", () => {
  it("renders an Open lesson link pointing to the lesson page", () => {
    renderRow(privateItem);
    const link = screen.getByRole("link", { name: "Open lesson" });
    expect(link).toHaveAttribute("href", `/coach/lessons/${LESSON_ID}`);
  });
});
