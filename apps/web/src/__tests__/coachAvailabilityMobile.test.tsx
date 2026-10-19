import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/coach/availability",
}));

vi.mock("@/lib/api/coachAvailability", () => ({
  createSeason: vi.fn(),
  patchSeason: vi.fn(),
  deleteSeason: vi.fn(),
  copyNextYear: vi.fn(),
  createOverride: vi.fn(),
  patchOverride: vi.fn(),
  deleteOverride: vi.fn(),
  fetchAvailabilityPreview: vi.fn(),
  patchAvailabilityConfig: vi.fn(),
  fetchSeasons: () => Promise.resolve([]),
}));

import CoachAvailabilityContent from "../content/CoachAvailabilityContent/CoachAvailabilityContent";
import type {
  AvailabilityConfig,
  AvailabilityPreviewResponse,
  SeasonWithIsCurrent,
} from "@swim-app/shared";

const TODAY = "2026-10-19";

const baseConfig: AvailabilityConfig = {
  id: "00000000-0000-0000-0000-000000000001",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00",
  defaultEndTime: "20:00",
};

const basePreview: AvailabilityPreviewResponse = {
  days: [
    { date: "2026-10-19", state: "open", windows: [{ start: "16:00", end: "20:00" }] },
    { date: "2026-10-20", state: "open", windows: [{ start: "16:00", end: "20:00" }] },
    { date: "2026-10-21", state: "closed", windows: [] },
    { date: "2026-10-22", state: "open", windows: [{ start: "16:00", end: "20:00" }] },
    { date: "2026-10-23", state: "open", windows: [{ start: "16:00", end: "20:00" }] },
    { date: "2026-10-24", state: "closed", windows: [] },
    { date: "2026-10-25", state: "open", windows: [{ start: "16:00", end: "20:00" }] },
  ],
};

function season(partial: Partial<SeasonWithIsCurrent> = {}): SeasonWithIsCurrent {
  return {
    id: "s-1",
    name: "Fall",
    startDate: "2026-09-01",
    endDate: "2099-12-31",
    teachesDays: [2, 3, 4, 5],
    weekdayStartTime: "16:00",
    weekdayEndTime: "20:00",
    weekendStartTime: "16:00",
    weekendEndTime: "20:00",
    startsAtDst: false,
    isCurrent: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function renderPage(seasons: SeasonWithIsCurrent[] = []) {
  return render(
    <CoachAvailabilityContent
      accessToken="test-token"
      initialSeasons={seasons}
      initialOverrides={[]}
      initialBlockedTimes={[]}
      initialPreview={basePreview}
      initialWeekStart="2026-10-19"
      initialConfig={baseConfig}
      today={TODAY}
    />,
  );
}

describe("Availability page — phone card sections", () => {
  it("renders a Seasons heading", () => {
    renderPage([season()]);
    expect(screen.getByRole("heading", { name: "Seasons" })).toBeInTheDocument();
  });

  it("renders a One-off changes heading (phone card)", () => {
    renderPage();
    const headings = screen.getAllByRole("heading", { name: "One-off changes" });
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it("renders What parents see heading (WeekPreview)", () => {
    renderPage();
    const previews = screen.getAllByText("What parents see");
    expect(previews.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Default hours section", () => {
    renderPage();
    expect(screen.getByText("Default hours")).toBeInTheDocument();
  });

  it("no tab buttons exist", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Seasons", pressed: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "One-off changes", pressed: false })).not.toBeInTheDocument();
  });

  it("Add season button is present in the phone Seasons card", () => {
    renderPage();
    const addBtns = screen.getAllByRole("button", { name: /\+ Add season/ });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("Add override button is present in the phone One-off changes card", () => {
    renderPage();
    const addBtns = screen.getAllByRole("button", { name: /\+ Add a day off or custom hours/ });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });
});
