import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/SiteFooter", () => ({ default: () => <footer /> }));
vi.mock("@/components/ConfirmDialog", () => ({
  default: (props: { title: string }) => <div data-testid="confirm-dialog">{props.title}</div>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import CoachMeetsContent from "../content/CoachMeetsContent/CoachMeetsContent";
import CoachMeetDetailContent from "../content/CoachMeetDetailContent/CoachMeetDetailContent";
import CoachSwimmerDetailContent from "../content/CoachSwimmerDetailContent/CoachSwimmerDetailContent";

vi.mock("@/components/AddNoteForm", () => ({ default: () => <div data-testid="add-note-form" /> }));
vi.mock("@/content/CoachSwimmerDetailContent/HidePublicButton", () => ({
  default: () => <button>Hide</button>,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerSkillsHistory", () => ({
  default: () => <div data-testid="skills-history" />,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerTimeline", () => ({
  default: () => <div data-testid="swimmer-timeline" />,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEET_ID = "11111111-0000-0000-0000-000000000001";
const SWIMMER_ID = "22222222-0000-0000-0000-000000000001";
const SWIM_ID = "33333333-0000-0000-0000-000000000001";

const now = "2025-01-01T00:00:00.000Z";

const testMeet = {
  id: MEET_ID,
  name: "Spring Invitational",
  meetDate: "2025-03-15",
  course: "scy" as const,
  createdAt: now,
  updatedAt: now,
};

const testSwim = {
  id: SWIM_ID,
  swimmerId: SWIMMER_ID,
  swimType: "meet" as const,
  meetId: MEET_ID,
  meetName: "Spring Invitational",
  meetDate: "2025-03-15",
  eventDistance: 100,
  eventStroke: "free" as const,
  course: "scy" as const,
  timeHundredths: 5830,
  timeString: "58.30",
  swumOn: "2025-03-15",
  createdAt: now,
};

const testPersonalBest = {
  eventDistance: 100,
  eventStroke: "free" as const,
  course: "scy" as const,
  timeHundredths: 5830,
  timeString: "58.30",
  swimId: SWIM_ID,
};

const testSwimmer = {
  id: SWIMMER_ID,
  firstName: "Alex",
  lastName: "Smith",
  age: 12,
  sex: "male" as const,
  isPublic: false,
  birthDate: "2013-01-01",
  currentLeagues: [],
  clubs: [],
  members: [],
  memberNames: [],
  homePool: null,
  createdAt: now,
  updatedAt: now,
};

// ── CoachMeetsContent ─────────────────────────────────────────────────────────

describe("CoachMeetsContent", () => {
  it("renders 'No meets yet' when list is empty", () => {
    render(<CoachMeetsContent meets={[]} />);
    expect(screen.getByText(/no meets yet/i)).toBeInTheDocument();
  });

  it("renders a meet row with name and date", () => {
    render(<CoachMeetsContent meets={[testMeet]} />);
    expect(screen.getByText("Spring Invitational")).toBeInTheDocument();
    expect(screen.getByText(/2025-03-15/)).toBeInTheDocument();
  });

  it("renders the Create meet button", () => {
    render(<CoachMeetsContent meets={[]} />);
    expect(screen.getByRole("button", { name: /create meet/i })).toBeInTheDocument();
  });

  it("links each meet to its detail page", () => {
    render(<CoachMeetsContent meets={[testMeet]} />);
    const link = screen.getByRole("link", { name: "Spring Invitational" });
    expect(link).toHaveAttribute("href", `/coach/meets/${MEET_ID}`);
  });
});

// ── CoachMeetDetailContent ────────────────────────────────────────────────────

describe("CoachMeetDetailContent", () => {
  const meetWithSwims = { ...testMeet, swims: [testSwim] };
  const emptyMeet = { ...testMeet, swims: [] };

  it("renders meet name and date", () => {
    render(<CoachMeetDetailContent meet={emptyMeet} swimmers={[]} />);
    expect(screen.getByRole("heading", { name: "Spring Invitational" })).toBeInTheDocument();
    expect(screen.getByText(/2025-03-15/)).toBeInTheDocument();
  });

  it("renders 'No swims recorded' when meet has no swims", () => {
    render(<CoachMeetDetailContent meet={emptyMeet} swimmers={[]} />);
    expect(screen.getByText(/no swims recorded/i)).toBeInTheDocument();
  });

  it("renders swim row with event and formatted time", () => {
    render(<CoachMeetDetailContent meet={meetWithSwims} swimmers={[]} />);
    expect(screen.getByText(/100 Freestyle/i)).toBeInTheDocument();
    expect(screen.getByText("58.30")).toBeInTheDocument();
  });

  it("renders back link to /coach/meets", () => {
    render(<CoachMeetDetailContent meet={emptyMeet} swimmers={[]} />);
    const link = screen.getByRole("link", { name: /all meets/i });
    expect(link).toHaveAttribute("href", "/coach/meets");
  });
});

// ── CoachSwimmerDetailContent — times section ─────────────────────────────────

describe("CoachSwimmerDetailContent — times", () => {
  const baseProps = {
    swimmer: testSwimmer,
    accessToken: "test-token",
    grades: {},
    startGrades: {},
    coachingPriorities: [],
    categories: [],
    timelineItems: [],
    meets: [],
  };

  it("renders Times heading", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    expect(screen.getByRole("heading", { name: "Times" })).toBeInTheDocument();
  });

  it("renders 'No times recorded yet' when swims is empty", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    expect(screen.getByText(/no times recorded yet/i)).toBeInTheDocument();
  });

  it("renders a swim row with formatted time", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[testSwim]} personalBests={[]} />,
    );
    expect(screen.getByText("58.30")).toBeInTheDocument();
  });

  it("shows PB badge on the personal-best swim", () => {
    render(
      <CoachSwimmerDetailContent
        {...baseProps}
        swims={[testSwim]}
        personalBests={[testPersonalBest]}
      />,
    );
    expect(screen.getByText("PB")).toBeInTheDocument();
  });

  it("renders personal bests table when PBs are present", () => {
    render(
      <CoachSwimmerDetailContent
        {...baseProps}
        swims={[testSwim]}
        personalBests={[testPersonalBest]}
      />,
    );
    expect(screen.getByText(/personal bests/i)).toBeInTheDocument();
  });

  it("renders the Add time button", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    expect(screen.getByRole("button", { name: /add time/i })).toBeInTheDocument();
  });
});
