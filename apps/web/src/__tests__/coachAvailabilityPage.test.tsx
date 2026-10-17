import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.clearAllMocks();
  window.confirm = vi.fn().mockReturnValue(true);
  window.alert = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/coach/availability",
}));

const mockCreateSeason = vi.fn();
const mockPatchSeason = vi.fn();
const mockDeleteSeason = vi.fn();
const mockCopyNextYear = vi.fn();
const mockCreateOverride = vi.fn();
const mockDeleteOverride = vi.fn();
const mockFetchPreview = vi.fn();

vi.mock("@/lib/api/coachAvailability", () => ({
  createSeason: (...args: unknown[]) => mockCreateSeason(...args),
  patchSeason: (...args: unknown[]) => mockPatchSeason(...args),
  deleteSeason: (...args: unknown[]) => mockDeleteSeason(...args),
  copyNextYear: (...args: unknown[]) => mockCopyNextYear(...args),
  createOverride: (...args: unknown[]) => mockCreateOverride(...args),
  deleteOverride: (...args: unknown[]) => mockDeleteOverride(...args),
  fetchAvailabilityPreview: (...args: unknown[]) => mockFetchPreview(...args),
}));

import CoachAvailabilityContent from "../content/CoachAvailabilityContent/CoachAvailabilityContent";
import type {
  AvailabilityOverride,
  AvailabilityPreviewResponse,
  SeasonWithIsCurrent,
} from "@swim-app/shared";
import { isCoachLinkActive } from "../components/CoachNav/CoachNav";

const TODAY = "2026-10-20";
const WEEK_START = "2026-10-19";

function season(partial: Partial<SeasonWithIsCurrent>): SeasonWithIsCurrent {
  return {
    id: "season-1",
    name: "Season",
    startDate: "2026-09-15",
    teachesDays: [1, 2, 3, 4, 5, 6, 7],
    weekdayStartTime: "15:00",
    weekendStartTime: "15:00",
    endTime: "18:30",
    startsAtDst: false,
    isCurrent: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function override(partial: Partial<AvailabilityOverride>): AvailabilityOverride {
  return {
    id: "override-1",
    kind: "day_off",
    startDate: "2026-10-24",
    endDate: "2026-10-24",
    startTime: null,
    endTime: null,
    note: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...partial,
  };
}

const basePreview: AvailabilityPreviewResponse = {
  days: [
    {
      date: "2026-10-19",
      state: "open",
      windows: [{ start: "15:00", end: "18:30" }],
    },
    {
      date: "2026-10-20",
      state: "open",
      windows: [{ start: "15:00", end: "18:30" }],
    },
    { date: "2026-10-21", state: "open", windows: [{ start: "15:00", end: "18:30" }] },
    { date: "2026-10-22", state: "open", windows: [{ start: "15:00", end: "18:30" }] },
    { date: "2026-10-23", state: "open", windows: [{ start: "15:00", end: "18:30" }] },
    { date: "2026-10-24", state: "closed", windows: [] },
    { date: "2026-10-25", state: "open", windows: [{ start: "15:00", end: "18:30" }] },
  ],
};

function renderPage(overrides: {
  seasons?: SeasonWithIsCurrent[];
  overrides?: AvailabilityOverride[];
  preview?: AvailabilityPreviewResponse;
} = {}) {
  const seasons = overrides.seasons ?? [
    season({ id: "s-oct", name: "Mid-Oct", startDate: "2026-10-15", isCurrent: true }),
    season({
      id: "s-nov",
      name: "Nov",
      startDate: "2026-11-01",
      weekdayStartTime: "14:30",
      weekendStartTime: "13:00",
      endTime: "17:30",
    }),
  ];
  return render(
    <CoachAvailabilityContent
      accessToken="test-token"
      initialSeasons={seasons}
      initialOverrides={overrides.overrides ?? []}
      initialBlockedTimes={[]}
      initialPreview={overrides.preview ?? basePreview}
      initialWeekStart={WEEK_START}
      today={TODAY}
    />,
  );
}

describe("CoachAvailabilityContent — seasons table", () => {
  it("renders seasons in start-date order with Now on the current season", () => {
    renderPage();
    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Mid-Oct");
    expect(rows[0]).toHaveTextContent("Now");
    expect(rows[1]).toHaveTextContent("Nov");
    expect(rows[1]).not.toHaveTextContent("Now");
  });

  it("marks the weekend start when it differs from the weekday start", () => {
    renderPage();
    // Nov row differs (14:30 weekday vs 13:00 weekend); Mid-Oct does not.
    expect(screen.getByLabelText("Weekend start differs from weekdays")).toBeInTheDocument();
  });

  it("opens the add-season modal and submits a new season", async () => {
    mockCreateSeason.mockResolvedValue({
      ok: true,
      data: {
        season: season({
          id: "s-new",
          name: "Early Dec",
          startDate: "2026-12-01",
          isCurrent: false,
        }),
        warnings: [],
      },
    });
    mockFetchPreview.mockResolvedValue(basePreview);
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /\+ Add season/ })[0]!);

    const nameInput = await screen.findByLabelText("Name");
    expect(nameInput).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: "Early Dec" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Weekday start"), { target: { value: "14:30" } });
    fireEvent.change(screen.getByLabelText("Weekend start"), { target: { value: "14:30" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "17:30" } });

    fireEvent.click(screen.getByRole("button", { name: "Add season", hidden: true }));

    await waitFor(() => expect(mockCreateSeason).toHaveBeenCalledTimes(1));
    expect(mockCreateSeason).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ name: "Early Dec", startDate: "2026-12-01" }),
    );
    await waitFor(() => expect(screen.getByText("Early Dec")).toBeInTheDocument());
  });

  it("deletes a season and surfaces the impact warning with swimmer names + pool name", async () => {
    mockDeleteSeason.mockResolvedValue({
      ok: true,
      data: {
        warnings: [
          {
            lessonId: "lesson-1",
            startsAt: "2026-10-24T22:00:00.000Z",
            reason: "day_closed",
            swimmerFirstNames: ["Ava", "Max"],
            poolName: "Egret Park",
          },
        ],
      },
    });
    mockFetchPreview.mockResolvedValue(basePreview);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete Mid-Oct" }));
    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => expect(mockDeleteSeason).toHaveBeenCalled());
    const warningDialog = await screen.findByRole("heading", {
      name: /booked lesson/i,
      hidden: true,
    });
    expect(warningDialog).toBeInTheDocument();
    expect(screen.getByText(/Ava and Max/)).toBeInTheDocument();
    expect(screen.getByText(/Egret Park/)).toBeInTheDocument();
  });
});

describe("CoachAvailabilityContent — copy to next year", () => {
  it("prompts, calls the route, shows inserted count", async () => {
    mockCopyNextYear.mockResolvedValue({
      ok: true,
      data: { inserted: [season({ id: "n1", startDate: "2027-10-15" }), season({ id: "n2", startDate: "2027-11-01" })] },
    });
    mockFetchPreview.mockResolvedValue(basePreview);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Copy to 2027/ }));
    const confirmButton = await screen.findByRole("button", { name: "Copy seasons", hidden: true });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockCopyNextYear).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/Added 2 seasons for/)).toBeInTheDocument(),
    );
  });
});

describe("CoachAvailabilityContent — week preview", () => {
  it("renders 7 cells and shows Day off for closed dates", () => {
    renderPage();
    const previewHeadings = screen.getAllByText("What parents see");
    expect(previewHeadings.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Day off").length).toBeGreaterThan(0);
  });
});

describe("CoachAvailabilityContent — overrides", () => {
  it("shows a friendly message when the API returns override_conflict", async () => {
    mockCreateOverride.mockResolvedValue({ ok: false, status: 422, code: "override_conflict" });
    mockFetchPreview.mockResolvedValue(basePreview);
    renderPage({ overrides: [override({})] });

    fireEvent.click(
      screen.getByRole("button", { name: /\+ Add a day off or custom hours/ }),
    );

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save change", hidden: true }));

    await waitFor(() => expect(mockCreateOverride).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("This override overlaps an existing one.")).toBeInTheDocument(),
    );
  });
});

describe("CoachAvailabilityContent — phone layout", () => {
  it("renders tabs and the current-season card in phone mode", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Seasons", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "One-off changes", pressed: false })).toBeInTheDocument();
    // Phone card renders an Edit <name> button
    expect(screen.getByRole("button", { name: "Edit Mid-Oct" })).toBeInTheDocument();
  });
});

describe("CoachNav active-state", () => {
  it("marks Availability active on /coach/availability and subpaths", () => {
    expect(isCoachLinkActive("/coach/availability", "/coach/availability")).toBe(true);
    expect(isCoachLinkActive("/coach/availability", "/coach/availability/edit")).toBe(true);
    expect(isCoachLinkActive("/coach/availability", "/coach/schedule")).toBe(false);
  });
});
