import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// mockUseActionState lets individual tests inject a specific action state.
// All other tests get the idle default set in beforeEach.
const { mockUseActionState } = vi.hoisted(() => ({ mockUseActionState: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: mockUseActionState };
});

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
  swimCount: 1,
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
  householdId: "00000000-0000-0000-0000-000000000ff0",
  currentLeagues: [],
  clubs: [],
  members: [],
  memberNames: [],
  lastLesson: null,
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
    grades: {},
    startGrades: {},
    coachingPriorities: [],
    categories: [],
    timelineItems: [],
    meets: [],
    drafts: [],
    golfScoreTrends: [],
  };

  // The times section lives inside the "Times" tab in the new layout. This
  // helper opens that tab before each assertion so the tests are still
  // scoped to visible content, not the entire DOM tree.
  function openTimesTab() {
    fireEvent.click(screen.getByRole("tab", { name: /^times$/i }));
  }

  it("renders Times heading", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    openTimesTab();
    expect(screen.getByRole("heading", { name: "Times" })).toBeInTheDocument();
  });

  it("renders 'No times recorded yet' when swims is empty", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    openTimesTab();
    expect(screen.getByText(/no times recorded yet/i)).toBeInTheDocument();
  });

  it("renders a swim row with formatted time", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[testSwim]} personalBests={[]} />,
    );
    openTimesTab();
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
    openTimesTab();
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
    openTimesTab();
    expect(screen.getByText(/personal bests/i)).toBeInTheDocument();
  });

  it("renders the Add meet time and Add practice swim buttons inside the Times tab", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    openTimesTab();
    expect(screen.getByRole("button", { name: /add meet time/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add practice swim/i })).toBeInTheDocument();
  });

  it("shows Practice label on a practice swim", () => {
    const practiceSwim = {
      ...testSwim,
      id: "44444444-0000-0000-0000-000000000001",
      swimType: "practice" as const,
      meetId: null,
      meetName: null,
      meetDate: null,
    };
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[practiceSwim]} personalBests={[]} />,
    );
    openTimesTab();
    expect(screen.getByText("Practice")).toBeInTheDocument();
  });

  it("does not show PB badge on a practice swim even when it matches a PB", () => {
    const practiceSwim = {
      ...testSwim,
      id: "44444444-0000-0000-0000-000000000002",
      swimType: "practice" as const,
      meetId: null,
      meetName: null,
      meetDate: null,
    };
    const pbForPractice = { ...testPersonalBest, swimId: practiceSwim.id };
    render(
      <CoachSwimmerDetailContent
        {...baseProps}
        swims={[practiceSwim]}
        personalBests={[pbForPractice]}
      />,
    );
    openTimesTab();
    expect(screen.queryByText("PB")).not.toBeInTheDocument();
  });

  it("header 'Add time' button jumps to the Times tab and opens the meet form", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps} swims={[]} personalBests={[]} />,
    );
    // Starts on the Feed tab — the Times "+ Add meet time" button isn't visible.
    expect(screen.queryByRole("button", { name: /^\+ add meet time$/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^add time$/i }));

    // After tapping the header button, the Times tab is active and the
    // AddSwimForm has opened in meet mode (its Review button is the
    // identifying landmark).
    expect(
      screen.getByRole("tab", { name: /^times$/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /^review$/i })).toBeInTheDocument();
  });
});

// Default idle state for all useActionState calls throughout the test suite.
beforeEach(() => {
  mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
});

describe("CoachMeetsContent — swim count and delete dialog", () => {
  it("shows swim count in the meet subtitle", () => {
    render(<CoachMeetsContent meets={[testMeet]} />);
    expect(screen.getByText(/1 swim/)).toBeInTheDocument();
  });

  it("shows plural swims when count > 1", () => {
    render(<CoachMeetsContent meets={[{ ...testMeet, swimCount: 3 }]} />);
    expect(screen.getByText(/3 swims/)).toBeInTheDocument();
  });

  it("does not show swim count when 0", () => {
    render(<CoachMeetsContent meets={[{ ...testMeet, swimCount: 0 }]} />);
    expect(screen.queryByText(/swim/)).not.toBeInTheDocument();
  });
});

// ── Form close on success ─────────────────────────────────────────────────────

// Helper to stage exactly N idle calls then one success, then fall back to default idle.
// useActionState is called once per render per component that uses it.
// meets=[] → only CreateMeetForm calls useActionState (1 call/render).
// meets=[x] → CreateMeetForm + MeetRow each call it (2 calls/render).
// emptyMeet/meetWithSwims → only AddSwimForm calls it (1 call/render).
function mockIdleThenSuccess(idleCallCount: number) {
  for (let index = 0; index < idleCallCount; index++) {
    mockUseActionState.mockReturnValueOnce([{ status: "idle" as const }, vi.fn(), false]);
  }
  mockUseActionState.mockReturnValueOnce([{ status: "success" as const }, vi.fn(), false]);
  // Remaining calls fall back to the beforeEach default (idle).
}

describe("CreateMeetForm — closes and shows list after successful save", () => {
  it("collapses the form and shows the Create meet button again", async () => {
    const user = userEvent.setup();
    // meets=[] → 1 useActionState call on initial render, then 1 on click render.
    mockIdleThenSuccess(1);

    render(<CoachMeetsContent meets={[]} />);
    await user.click(screen.getByRole("button", { name: /create meet/i }));

    expect(screen.getByRole("button", { name: /create meet/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /new meet/i })).not.toBeInTheDocument();
  });

  it("still renders existing meets after form closes", async () => {
    const user = userEvent.setup();
    // meets=[testMeet] → CreateMeetForm + MeetRow = 2 calls on initial render, then 2 on click render.
    mockIdleThenSuccess(3); // 2 initial + CreateMeetForm on click = 3rd call is success; MeetRow gets idle from default.

    render(<CoachMeetsContent meets={[testMeet]} />);
    await user.click(screen.getByRole("button", { name: /create meet/i }));

    expect(screen.getByText("Spring Invitational")).toBeInTheDocument();
  });
});

describe("CoachMeetDetailContent AddSwimForm — opens and closes", () => {
  it("shows the form when Add swim is clicked", async () => {
    const user = userEvent.setup();

    const emptyMeet = { ...testMeet, swims: [] };
    render(<CoachMeetDetailContent meet={emptyMeet} swimmers={[]} />);

    await user.click(screen.getByRole("button", { name: /add swim/i }));

    expect(screen.getByRole("heading", { name: /add swim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save swim/i })).toBeInTheDocument();
  });

  it("collapses the form when Cancel is clicked", async () => {
    const user = userEvent.setup();

    const emptyMeet = { ...testMeet, swims: [] };
    render(<CoachMeetDetailContent meet={emptyMeet} swimmers={[]} />);

    await user.click(screen.getByRole("button", { name: /add swim/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /add swim/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /add swim/i })).not.toBeInTheDocument();
  });

  it("still renders existing swims while form is open", async () => {
    const user = userEvent.setup();

    const meetWithSwims = { ...testMeet, swims: [testSwim] };
    render(<CoachMeetDetailContent meet={meetWithSwims} swimmers={[]} />);

    await user.click(screen.getByRole("button", { name: /add swim/i }));

    expect(screen.getByText("58.30")).toBeInTheDocument();
  });
});
