import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/content/CoachMeetDetailContent/actions", () => ({
  saveBatchForMeet: vi.fn(),
  patchMeetHeader: vi.fn(),
  patchSavedSwim: vi.fn(),
  deleteSavedSwim: vi.fn(),
  addSwim: vi.fn(),
}));

import CoachMeetDetailContent from "../content/CoachMeetDetailContent/CoachMeetDetailContent";

const MEET_ID = "11111111-0000-0000-0000-000000000001";
const SWIMMER_ID = "22222222-0000-0000-0000-000000000001";
const SWIMMER_TWIN_ID = "33333333-0000-0000-0000-000000000003";
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

function makeSwimmer(overrides: {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  householdName?: string;
  birthMonthYear?: string;
}) {
  return {
    id: overrides.id,
    firstName: overrides.firstName,
    lastName: overrides.lastName,
    age: overrides.age,
    sex: "male" as const,
    isPublic: false,
    householdId: "00000000-0000-0000-0000-000000000ff0",
    householdName: overrides.householdName ?? "Smith",
    birthMonthYear: overrides.birthMonthYear ?? "2013-01",
    currentLeagues: [] as Array<"club" | "summer_league">,
    clubs: [] as Array<{
      id: string;
      swimmerId: string;
      clubId: string | null;
      clubName: string | null;
      otherClubName: string | null;
      createdAt: string;
      updatedAt: string;
    }>,
    members: [],
    memberNames: [],
    lastLesson: null,
    homePool: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Add result — swimmer picker options", () => {
  it("renders a native select with placeholder + sorted options", () => {
    const swimmers = [
      makeSwimmer({ id: "b", firstName: "Riley", lastName: "Jones", age: 10 }),
      makeSwimmer({ id: "a", firstName: "Alex", lastName: "Smith", age: 12 }),
    ];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    const select = screen.getByLabelText("Swimmer") as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options[0]).toBe("Choose a swimmer");
    expect(options[1]).toBe("Alex Smith · Age 12");
    expect(options[2]).toBe("Riley Jones · Age 10");
  });

  it("disambiguates same-name swimmers with household family", () => {
    const swimmers = [
      makeSwimmer({ id: "a", firstName: "Alex", lastName: "Smith", age: 12, householdName: "Garcia" }),
      makeSwimmer({ id: "b", firstName: "Alex", lastName: "Smith", age: 10, householdName: "Patel" }),
    ];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    const select = screen.getByLabelText("Swimmer") as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toContain("Alex Smith · Age 12 · Garcia family");
    expect(labels).toContain("Alex Smith · Age 10 · Patel family");
  });

  it("adds birth month+year when household still collides", () => {
    const swimmers = [
      makeSwimmer({
        id: "a",
        firstName: "Alex",
        lastName: "Smith",
        age: 12,
        householdName: "Garcia",
        birthMonthYear: "2013-01",
      }),
      makeSwimmer({
        id: SWIMMER_TWIN_ID,
        firstName: "Alex",
        lastName: "Smith",
        age: 12,
        householdName: "Garcia",
        birthMonthYear: "2013-06",
      }),
    ];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    const select = screen.getByLabelText("Swimmer") as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toContain("Alex Smith · Age 12 · Garcia family · January 2013");
    expect(labels).toContain("Alex Smith · Age 12 · Garcia family · June 2013");
  });
});

describe("Add result — best-time hint", () => {
  it("renders 'Best: <time>' when the swimmer has a PB for the selected event+course", async () => {
    const user = userEvent.setup();
    const swimmers = [makeSwimmer({ id: SWIMMER_ID, firstName: "Alex", lastName: "Smith", age: 12 })];
    render(
      <CoachMeetDetailContent
        meet={testMeet}
        swimmers={swimmers}
        swimmerBests={[
          {
            swimmerId: SWIMMER_ID,
            personalBests: [
              {
                eventDistance: 50,
                eventStroke: "free",
                course: "scy",
                timeHundredths: 3283,
                timeString: "32.83",
                swimId: "aaa",
              },
            ],
          },
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Swimmer"), SWIMMER_ID);
    // PB is at 50 Free SCY. Default is 25 (first valid free distance), so
    // tap 50 to align the event with the PB before asserting the hint.
    await user.click(screen.getByRole("radio", { name: "50" }));
    const section = screen.getByRole("region", { name: /add result/i });
    expect(within(section).getByText(/Best:/)).toBeInTheDocument();
    expect(within(section).getByText("32.83")).toBeInTheDocument();
  });

  it("renders 'No time in this event yet' when no PB exists", async () => {
    const user = userEvent.setup();
    const swimmers = [makeSwimmer({ id: SWIMMER_ID, firstName: "Alex", lastName: "Smith", age: 12 })];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    await user.selectOptions(screen.getByLabelText("Swimmer"), SWIMMER_ID);
    expect(screen.getByText(/no time in this event yet/i)).toBeInTheDocument();
  });
});

describe("Add result — inline validation", () => {
  it("shows 'Choose a swimmer' and keeps other typed values intact when swimmer missing", async () => {
    const user = userEvent.setup();
    const swimmers = [makeSwimmer({ id: SWIMMER_ID, firstName: "Alex", lastName: "Smith", age: 12 })];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    // Type a time
    await user.click(screen.getByLabelText("Seconds"));
    await user.keyboard("25");
    await user.click(screen.getByLabelText("Hundredths"));
    await user.keyboard("41");
    // Tap add without choosing a swimmer
    await user.click(screen.getByRole("button", { name: /add result/i }));

    // Swimmer-level error appears + no pending rows
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("Choose a swimmer"))).toBe(true);
    expect(screen.queryByTestId("pending-row")).toBeNull();

    // Time values are preserved
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("41");
  });

  it("shows 'Enter a time' and keeps swimmer selected when time missing", async () => {
    const user = userEvent.setup();
    const swimmers = [makeSwimmer({ id: SWIMMER_ID, firstName: "Alex", lastName: "Smith", age: 12 })];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    await user.selectOptions(screen.getByLabelText("Swimmer"), SWIMMER_ID);
    await user.click(screen.getByRole("button", { name: /add result/i }));

    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("Enter a time"))).toBe(true);
    // Swimmer is still selected
    expect((screen.getByLabelText("Swimmer") as HTMLSelectElement).value).toBe(SWIMMER_ID);
  });
});

describe("Add result — clears vs stays after a successful add", () => {
  it("clears swimmer + time, keeps stroke + distance, after a successful add", async () => {
    const user = userEvent.setup();
    const swimmers = [makeSwimmer({ id: SWIMMER_ID, firstName: "Alex", lastName: "Smith", age: 12 })];
    render(
      <CoachMeetDetailContent meet={testMeet} swimmers={swimmers} swimmerBests={[]} />,
    );
    // Change to Fly first — stroke changes should persist after add.
    await user.click(screen.getByRole("radio", { name: "Fly" }));
    // Pick a distance of 100 (valid for fly).
    await user.click(screen.getByRole("radio", { name: "100" }));

    // Fill and submit
    await user.selectOptions(screen.getByLabelText("Swimmer"), SWIMMER_ID);
    await user.click(screen.getByLabelText("Seconds"));
    await user.keyboard("58");
    await user.click(screen.getByLabelText("Hundredths"));
    await user.keyboard("30");
    await user.click(screen.getByRole("button", { name: /add result/i }));

    // Pending row recorded
    expect(screen.getAllByTestId("pending-row")).toHaveLength(1);

    // Swimmer cleared
    expect((screen.getByLabelText("Swimmer") as HTMLSelectElement).value).toBe("");
    // Time cleared
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("");
    // Stroke + distance stay: Fly / 100 still selected
    expect(screen.getByRole("radio", { name: "Fly", checked: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "100", checked: true })).toBeInTheDocument();
  });
});
