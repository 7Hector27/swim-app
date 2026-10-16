import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/leaderboard/club",
}));

import BoardTable from "@/components/BoardTable";
import BoardFilters from "@/components/BoardFilters";
import ClubBoardContent from "@/content/ClubBoardContent";
import type { PublicBoardRow, PublicMasterRow } from "@swim-app/shared";

const baseRow: PublicBoardRow = {
  firstName: "Maya",
  lastInitial: "R",
  ageGroup: "9-10",
  sex: "female",
  time: "0:28.45",
  eventDistance: 50,
  eventStroke: "free",
  course: "scy",
  rank: 1,
};

const secondRow: PublicBoardRow = {
  firstName: "Ethan",
  lastInitial: "K",
  ageGroup: "11-12",
  sex: "male",
  time: "0:29.10",
  eventDistance: 100,
  eventStroke: "back",
  course: "scy",
  rank: 2,
};

const tiedRow: PublicBoardRow = {
  firstName: "Liam",
  lastInitial: "T",
  ageGroup: "9-10",
  sex: "male",
  time: "0:28.45",
  eventDistance: 50,
  eventStroke: "free",
  course: "scy",
  rank: 1,
};

const masterRow: PublicMasterRow = {
  ...baseRow,
  standard: "AAA",
};

const secondMasterRow: PublicMasterRow = {
  ...secondRow,
  standard: "B",
};

beforeEach(() => {
  mockPush.mockClear();
});

describe("BoardTable", () => {
  it("renders empty state when rows is empty", () => {
    render(<BoardTable rows={[]} />);
    expect(
      screen.getByText("No times match those filters — try adjusting your selection."),
    ).toBeTruthy();
  });

  it("renders both swimmer names when given 2 rows", () => {
    render(<BoardTable rows={[baseRow, secondRow]} />);
    expect(screen.getByText("Maya R.")).toBeTruthy();
    expect(screen.getByText("Ethan K.")).toBeTruthy();
  });

  it("shows the same rank for tied rows", () => {
    render(<BoardTable rows={[baseRow, tiedRow]} />);
    const rankCells = screen.getAllByText("1");
    expect(rankCells.length).toBe(2);
  });

  it("never renders a full last name — only last initials", () => {
    render(<BoardTable rows={[baseRow, secondRow]} />);
    expect(screen.queryByText(/\bRoberts\b/)).toBeNull();
    expect(screen.queryByText(/\bKelly\b/)).toBeNull();
    expect(screen.getByText("Maya R.")).toBeTruthy();
    expect(screen.getByText("Ethan K.")).toBeTruthy();
  });

  it("does not render any swimmerId field in the DOM", () => {
    const rowWithNoId: PublicBoardRow = { ...baseRow };
    const { container } = render(<BoardTable rows={[rowWithNoId]} />);
    expect(container.innerHTML).not.toContain("swimmerId");
  });

  it("does not show Standard column header when showStandard is false", () => {
    render(<BoardTable rows={[masterRow, secondMasterRow]} showStandard={false} />);
    expect(screen.queryByText("Standard")).toBeNull();
  });

  it("shows Standard column header when showStandard is true", () => {
    render(<BoardTable rows={[masterRow, secondMasterRow]} showStandard={true} />);
    expect(screen.getByText("Standard")).toBeTruthy();
  });
});

describe("BoardFilters — URL updates", () => {
  it("selecting a stroke calls router.push with eventStroke in the URL", () => {
    render(<BoardFilters />);
    fireEvent.change(screen.getByDisplayValue("All strokes"), {
      target: { value: "back" },
    });
    expect(mockPush).toHaveBeenCalledWith("/leaderboard/club?eventStroke=back");
  });

  it("selecting a course calls router.push with course in the URL", () => {
    render(<BoardFilters />);
    fireEvent.change(screen.getByDisplayValue("All courses"), {
      target: { value: "lcm" },
    });
    expect(mockPush).toHaveBeenCalledWith("/leaderboard/club?course=lcm");
  });

  it("selecting an age group calls router.push with ageGroup in the URL", () => {
    render(<BoardFilters />);
    fireEvent.change(screen.getByDisplayValue("All ages"), {
      target: { value: "9-10" },
    });
    expect(mockPush).toHaveBeenCalledWith("/leaderboard/club?ageGroup=9-10");
  });

  it("clearing a filter removes its param from the URL", () => {
    render(<BoardFilters />);
    // Set a filter, then clear it
    fireEvent.change(screen.getByDisplayValue("All strokes"), {
      target: { value: "free" },
    });
    fireEvent.change(screen.getByDisplayValue("All strokes"), {
      target: { value: "" },
    });
    // Second call should have no eventStroke param
    const lastCall = mockPush.mock.calls.at(-1);
    expect(lastCall?.[0]).not.toContain("eventStroke");
  });
});

describe("ClubBoardContent — rows shown", () => {
  it("renders swimmer rows received as props from the server fetch", () => {
    render(<ClubBoardContent rows={[baseRow, secondRow]} />);
    expect(screen.getByText("Maya R.")).toBeTruthy();
    expect(screen.getByText("Ethan K.")).toBeTruthy();
  });

  it("shows empty state when server returns no rows for the active filters", () => {
    render(<ClubBoardContent rows={[]} />);
    expect(
      screen.getByText("No times match those filters — try adjusting your selection."),
    ).toBeTruthy();
  });
});
