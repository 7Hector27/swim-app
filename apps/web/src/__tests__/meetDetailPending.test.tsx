import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const { saveBatchMock } = vi.hoisted(() => ({ saveBatchMock: vi.fn() }));
vi.mock("@/content/CoachMeetDetailContent/actions", () => ({
  saveBatchForMeet: saveBatchMock,
  patchMeetHeader: vi.fn(),
  patchSavedSwim: vi.fn(),
  deleteSavedSwim: vi.fn(),
  addSwim: vi.fn(),
}));

import CoachMeetDetailContent from "../content/CoachMeetDetailContent/CoachMeetDetailContent";

const MEET_ID = "11111111-0000-0000-0000-000000000001";
const SWIMMER_ID = "22222222-0000-0000-0000-000000000001";
const now = "2025-01-01T00:00:00.000Z";

const testMeet = {
  id: MEET_ID,
  name: "Spring Invitational",
  meetDate: "2025-03-15",
  course: "scy" as const,
  createdAt: now,
  updatedAt: now,
  swims: [],
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
  lastLesson: null,
  homePool: null,
  createdAt: now,
  updatedAt: now,
};

async function addOnePendingRow(user: ReturnType<typeof userEvent.setup>, time: string): Promise<void> {
  // Click the swimmer in the dropdown.
  await user.click(screen.getByRole("button", { name: /Alex Smith/i }));
  // Type the time into the TimeInput (seconds + hundredths).
  await user.click(screen.getByLabelText("Seconds"));
  await user.keyboard(time.split(".")[0]!);
  await user.click(screen.getByLabelText("Hundredths"));
  await user.keyboard(time.split(".")[1]!);
  // Change distance to 100 (TimeInput and distance default 50 are fine too; pick 100 to match PB).
  await user.selectOptions(screen.getByLabelText(/distance/i), "100");
  await user.click(screen.getByRole("button", { name: /add result/i }));
}

beforeEach(() => {
  saveBatchMock.mockReset();
  // Clean storage between tests
  window.localStorage.clear();
});

describe("Pending list — feedback", () => {
  it("shows 'First time in this event' when swimmer has no prior swim in that event+course", async () => {
    const user = userEvent.setup();
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={[testSwimmer]} swimmerBests={[]} />,
    );
    await addOnePendingRow(user, "58.30");
    const feedback = screen.getByTestId("pending-row-feedback");
    expect(feedback).toHaveTextContent(/first time in this event/i);
  });

  it("shows 'New best, X faster' when the time beats the swimmer's PB for that event+course", async () => {
    const user = userEvent.setup();
    render(
      <CoachMeetDetailContent
        meet={testMeet}
        swimmers={[testSwimmer]}
        swimmerBests={[
          {
            swimmerId: SWIMMER_ID,
            personalBests: [
              {
                eventDistance: 100,
                eventStroke: "free",
                course: "scy",
                timeHundredths: 6000,
                timeString: "1:00.00",
                swimId: "aaa",
              },
            ],
          },
        ]}
      />,
    );
    await addOnePendingRow(user, "58.30"); // 58.30 < 1:00.00 PB
    const feedback = screen.getByTestId("pending-row-feedback");
    expect(feedback).toHaveTextContent(/new best/i);
    expect(feedback).toHaveTextContent(/faster/i);
  });

  it("flags a duplicate when the exact same (swimmer+event+course+time) is already saved", async () => {
    const user = userEvent.setup();
    const meetWithSavedSwim = {
      ...testMeet,
      swims: [
        {
          id: "swim-1",
          swimmerId: SWIMMER_ID,
          swimmerFirstName: "Alex",
          swimmerLastName: "Smith",
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
        },
      ],
    };
    render(
      <CoachMeetDetailContent
        meet={meetWithSavedSwim}
        swimmers={[testSwimmer]}
        swimmerBests={[]}
      />,
    );
    await addOnePendingRow(user, "58.30");
    const feedback = screen.getByTestId("pending-row-feedback");
    expect(feedback).toHaveTextContent(/duplicate/i);
  });
});

describe("Pending list — localStorage restore", () => {
  it("rehydrates pending rows from localStorage on mount", () => {
    window.localStorage.setItem(
      `axiom-aquatics:meet-pending:${MEET_ID}`,
      JSON.stringify([
        {
          id: "row-1",
          swimmerId: SWIMMER_ID,
          eventDistance: 50,
          eventStroke: "free",
          course: "scy",
          timeHundredths: 2541,
        },
      ]),
    );
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={[testSwimmer]} swimmerBests={[]} />,
    );
    expect(screen.getByTestId("pending-row")).toBeInTheDocument();
    expect(screen.getByText(/25.41/)).toBeInTheDocument();
  });
});

describe("Save results — batch all-or-nothing", () => {
  it("keeps every row and annotates failing rows when the batch returns per-row errors", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      `axiom-aquatics:meet-pending:${MEET_ID}`,
      JSON.stringify([
        {
          id: "row-1",
          swimmerId: SWIMMER_ID,
          eventDistance: 50,
          eventStroke: "free",
          course: "scy",
          timeHundredths: 2541,
        },
        {
          id: "row-2",
          swimmerId: SWIMMER_ID,
          eventDistance: 100,
          eventStroke: "free",
          course: "scy",
          timeHundredths: 5830,
        },
      ]),
    );
    saveBatchMock.mockResolvedValue({
      status: "row_errors",
      rowErrors: [{ index: 1, error: "duplicate_swim" }],
    });
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={[testSwimmer]} swimmerBests={[]} />,
    );
    await user.click(screen.getByRole("button", { name: /save results/i }));

    // Both rows still rendered.
    expect(screen.getAllByTestId("pending-row")).toHaveLength(2);
    // The failing row carries its server reason.
    const alerts = screen.getAllByRole("alert");
    const bannerShown = alerts.some((el) =>
      el.textContent?.includes("Some results couldn't be saved"),
    );
    expect(bannerShown).toBe(true);
    const rowErrorShown = alerts.some((el) => el.textContent?.includes("duplicate_swim"));
    expect(rowErrorShown).toBe(true);
  });
});
