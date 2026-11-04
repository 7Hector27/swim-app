import { vi, describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const {
  mockDeleteSeason,
  mockFetchSeasonDeleteImpact,
  mockFetchAvailabilityPreview,
} = vi.hoisted(() => ({
  mockDeleteSeason: vi.fn(),
  mockFetchSeasonDeleteImpact: vi.fn(),
  mockFetchAvailabilityPreview: vi.fn(),
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.clearAllMocks();
  // The DELETE action returns impact warnings in the real server; the
  // modal flow uses the pre-fetched preview so these come back empty.
  mockDeleteSeason.mockResolvedValue({ ok: true, data: { warnings: [] } });
  mockFetchSeasonDeleteImpact.mockResolvedValue({
    ok: true,
    data: { warnings: [] },
  });
  mockFetchAvailabilityPreview.mockResolvedValue({ ok: true, data: { days: [] } });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/coach/availability",
}));

// Mock the server actions directly: calling the real actions reaches
// Next's `cookies()` / Supabase SSR client, which require a request
// scope that jsdom cannot provide. Only the actions this flow exercises
// need real stubs; the rest are no-ops.
vi.mock("@/content/CoachAvailabilityContent/actions", () => ({
  fetchSeasonsAction: () => Promise.resolve([]),
  createSeasonAction: vi.fn(),
  patchSeasonAction: vi.fn(),
  deleteSeasonAction: (...args: unknown[]) =>
    mockDeleteSeason("token", ...args.map((arg) => arg)),
  fetchSeasonDeleteImpactAction: (id: string) =>
    mockFetchSeasonDeleteImpact("token", id),
  copyNextYearAction: vi.fn(),
  createOverrideAction: vi.fn(),
  patchOverrideAction: vi.fn(),
  deleteOverrideAction: vi.fn(),
  fetchAvailabilityPreviewAction: (from: string, days: number) =>
    mockFetchAvailabilityPreview(from, days),
  patchAvailabilityConfigAction: vi.fn(),
}));

import CoachAvailabilityContent from "../content/CoachAvailabilityContent/CoachAvailabilityContent";
import type {
  AvailabilityConfig,
  AvailabilityPreviewResponse,
  ImpactWarning,
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
    id: "season-fall",
    name: "Fall",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
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

function renderPage(seasons: SeasonWithIsCurrent[]) {
  return render(
    <CoachAvailabilityContent
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

async function openEditModalForSeason(name: string) {
  // The phone SeasonCard renders an "Edit <name>" button; the Edit
  // modal uses role="dialog" with aria-labelledby pointing at an
  // "Edit season" heading.
  const editButtons = screen.getAllByRole("button", { name: `Edit ${name}` });
  fireEvent.click(editButtons[0]!);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Edit season" })).toBeInTheDocument(),
  );
}

describe("Delete season from the Edit modal", () => {
  it("adds a quiet Delete season button only in edit mode", async () => {
    renderPage([season()]);
    await openEditModalForSeason("Fall");
    const deleteBtn = screen.getByRole("button", { name: "Delete season" });
    expect(deleteBtn).toBeInTheDocument();
    // Classes include the quiet "border border-danger text-danger" styling,
    // not the solid "bg-danger" the confirm step uses.
    expect(deleteBtn.className).toContain("border-danger");
    expect(deleteBtn.className).toContain("text-danger");
    expect(deleteBtn.className).not.toContain("bg-danger");
  });

  it("opens a confirm step with the season name, dates, and defaults message", async () => {
    renderPage([season({ name: "Fall", startDate: "2026-09-01", endDate: "2026-12-31" })]);
    await openEditModalForSeason("Fall");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete season" }));
    });

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Delete Fall?" }),
      ).toBeInTheDocument(),
    );
    // Dates expressed with "to" per the no-dashes rule.
    expect(
      screen.getByText(/Sep 1 to Dec 31/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your default hours will apply/),
    ).toBeInTheDocument();
    // Final confirm button is solid red (bg-danger), not the quiet one.
    const confirmBtn = screen.getByRole("button", { name: "Delete season" });
    expect(confirmBtn.className).toContain("bg-danger");
  });

  it("lists each affected lesson in the confirm step and keeps the delete call blocked until the preview resolves", async () => {
    const warnings: ImpactWarning[] = [
      {
        lessonId: "l-1",
        startsAt: "2026-11-20T22:00:00-08:00",
        reason: "outside_hours",
        swimmerFirstNames: ["Ava"],
        poolName: "Egret Park",
      },
      {
        lessonId: "l-2",
        startsAt: "2026-12-04T23:30:00-08:00",
        reason: "day_closed",
        swimmerFirstNames: ["Max", "Noa"],
        poolName: "Clubhouse",
      },
    ];
    let resolveImpact: (value: {
      ok: true;
      data: { warnings: ImpactWarning[] };
    }) => void = () => {};
    mockFetchSeasonDeleteImpact.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveImpact = resolve;
      }),
    );

    renderPage([season()]);
    await openEditModalForSeason("Fall");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete season" }));
    });

    // Loading state visible while impact is being computed; confirm is
    // disabled so the coach can't delete without seeing the preview.
    await waitFor(() =>
      expect(screen.getByText(/Checking booked lessons/)).toBeInTheDocument(),
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete season" });
    expect(confirmBtn).toBeDisabled();

    await act(async () => {
      resolveImpact({ ok: true, data: { warnings } });
    });

    await waitFor(() =>
      expect(
        screen.getByText(/2 booked lessons would fall outside/),
      ).toBeInTheDocument(),
    );
    // Each lesson row is rendered with swimmer and pool.
    expect(screen.getByText(/Ava · Egret Park/)).toBeInTheDocument();
    expect(screen.getByText(/Max and Noa · Clubhouse/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete season" }),
    ).not.toBeDisabled();
  });

  it("calls deleteSeason on confirm and removes the season from the list", async () => {
    renderPage([season({ name: "Fall", id: "season-fall" })]);
    await openEditModalForSeason("Fall");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete season" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Delete Fall?" })).toBeInTheDocument(),
    );

    const dialog = screen.getByRole("heading", { name: "Delete Fall?" }).closest("dialog")!;
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete season" }));
    });

    await waitFor(() => expect(mockDeleteSeason).toHaveBeenCalledTimes(1));
    expect(mockDeleteSeason.mock.calls[0]![1]).toBe("season-fall");
    // After delete the modal is gone and the preview is refetched so
    // the on-screen calendar reflects the fallback defaults.
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Delete Fall?" }),
      ).not.toBeInTheDocument(),
    );
    expect(mockFetchAvailabilityPreview).toHaveBeenCalled();
  });

  it("Keep season cancels the confirm step without deleting", async () => {
    renderPage([season()]);
    await openEditModalForSeason("Fall");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete season" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Delete Fall?" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep season" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Delete Fall?" }),
      ).not.toBeInTheDocument(),
    );
    expect(mockDeleteSeason).not.toHaveBeenCalled();
  });
});
