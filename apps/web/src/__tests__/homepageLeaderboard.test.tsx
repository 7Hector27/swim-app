import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PublicBoardResponse, PublicMasterResponse } from "@swim-app/shared";

const {
  mockFetchSummary,
  mockFetchClub,
  mockFetchISL,
  mockFetchMaster,
} = vi.hoisted(() => ({
  mockFetchSummary: vi.fn(),
  mockFetchClub: vi.fn(),
  mockFetchISL: vi.fn(),
  mockFetchMaster: vi.fn(),
}));

vi.mock("@/lib/api/leaderboard", () => ({
  fetchLeaderboardSummary: mockFetchSummary,
  fetchClubBoard: mockFetchClub,
  fetchISLBoard: mockFetchISL,
  fetchMasterBoard: mockFetchMaster,
}));

vi.mock("@/components/ScrollReveal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../content/HomepageContent/ScrollFadeArea", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import LeaderboardSection from "../content/HomepageContent/LeaderboardSection";

type PublicRow = PublicBoardResponse["rows"][number];
type MasterRow = PublicMasterResponse["rows"][number];

function row(overrides: Partial<PublicRow> = {}): PublicRow {
  return {
    firstName: "Maya",
    lastInitial: "R",
    sex: "female",
    ageGroup: "11-12",
    rank: 1,
    time: "32.83",
    eventDistance: 50,
    eventStroke: "free",
    course: "scy",
    ...overrides,
  };
}

function masterRow(overrides: Partial<MasterRow> = {}): MasterRow {
  return {
    firstName: "Maya",
    lastInitial: "R",
    sex: "female",
    ageGroup: "11-12",
    rank: 1,
    time: "32.83",
    eventDistance: 50,
    eventStroke: "free",
    course: "scy",
    standard: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetchSummary.mockReset();
  mockFetchClub.mockReset();
  mockFetchISL.mockReset();
  mockFetchMaster.mockReset();
});

describe("HomepageContent — LeaderboardSection", () => {
  it("returns null when zero boards qualify (section is hidden)", async () => {
    mockFetchSummary.mockResolvedValue({ qualifying: [] });
    const result = await LeaderboardSection();
    expect(result).toBeNull();
  });

  it("renders only the qualifying board when one qualifies", async () => {
    mockFetchSummary.mockResolvedValue({ qualifying: ["club"] });
    mockFetchClub.mockResolvedValue({
      rows: [row(), row({ firstName: "Ethan", lastInitial: "K", rank: 1, eventStroke: "back" })],
    });
    mockFetchISL.mockResolvedValue(null);
    mockFetchMaster.mockResolvedValue(null);

    const element = await LeaderboardSection();
    render(element!);
    expect(screen.getByRole("heading", { level: 2, name: /leaderboards/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /club swim/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: /irvine summer/i })).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: /master/i })).toBeNull();
  });

  it("renders three cards when all three boards qualify", async () => {
    mockFetchSummary.mockResolvedValue({ qualifying: ["club", "isl", "master"] });
    mockFetchClub.mockResolvedValue({ rows: [row()] });
    mockFetchISL.mockResolvedValue({ rows: [row({ firstName: "Liam", lastInitial: "T" })] });
    mockFetchMaster.mockResolvedValue({ rows: [masterRow()] });

    const element = await LeaderboardSection();
    render(element!);

    expect(screen.getByRole("heading", { level: 3, name: /club swim/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /irvine summer/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /all swimmers/i })).toBeInTheDocument();
  });

  it("never renders the hardcoded placeholder names", async () => {
    mockFetchSummary.mockResolvedValue({ qualifying: ["club"] });
    mockFetchClub.mockResolvedValue({ rows: [row()] });
    mockFetchISL.mockResolvedValue(null);
    mockFetchMaster.mockResolvedValue(null);

    const element = await LeaderboardSection();
    render(element!);

    expect(screen.queryByText(/\[Club/)).toBeNull();
    expect(screen.queryByText(/\[0:00\.00\]/)).toBeNull();
    expect(screen.queryByText("Liam T.")).toBeNull();
    expect(screen.queryByText("Ethan K.")).toBeNull();
    expect(screen.queryByText("Sofia M.")).toBeNull();
  });
});
