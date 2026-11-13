import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  BulkCancelConfirmResponse,
  BulkCancelPreviewResponse,
  LessonLocation,
} from "@swim-app/shared";

const previewSpy = vi.fn();
const confirmSpy = vi.fn();

vi.mock("@/lib/api/coachBulkCancel", () => ({
  postBulkCancelPreview: (...args: unknown[]) => previewSpy(...args),
  postBulkCancelConfirm: (...args: unknown[]) => confirmSpy(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import CoachBulkCancelContent from "../content/CoachBulkCancelContent/CoachBulkCancelContent";

const POOL: LessonLocation = {
  id: "00000000-0000-0000-0000-000000000031",
  name: "Egret Park",
  address: "45 Ovation",
  city: "Irvine",
  state: "CA",
  zip: "92620",
  isHomePool: false,
  isActive: true,
  sortOrder: 0,
};

function emptyPreview(startDate: string, endDate: string): BulkCancelPreviewResponse {
  return {
    startDate,
    endDate,
    startTime: null,
    endTime: null,
    locationId: null,
    locationName: null,
    approvedCount: 0,
    pendingCount: 0,
    householdCount: 0,
    lessons: [],
    perHouseholdRefunds: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  previewSpy.mockImplementation((_token: string, body: { startDate: string; endDate: string }) =>
    Promise.resolve({ ok: true, data: emptyPreview(body.startDate, body.endDate) }),
  );
  confirmSpy.mockResolvedValue({
    ok: true,
    data: {
      bulkCancellationId: "00000000-0000-0000-0000-000000000099",
      canceledLessonCount: 0,
      declinedLessonCount: 0,
      affectedHouseholdCount: 0,
      blockApplied: false,
    } satisfies BulkCancelConfirmResponse,
  });
});

describe("CoachBulkCancelContent date editing", () => {
  it("lets the coach change both start and end dates and auto-refreshes the preview", async () => {
    render(
      <CoachBulkCancelContent
        accessToken="token"
        namedPools={[POOL]}
        today="2026-11-02"
        initialStartDate="2026-11-02"
        initialEndDate="2026-11-02"
        initialLocationId={null}
      />,
    );

    const startInput = screen.getByLabelText(/start date/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/end date/i) as HTMLInputElement;

    expect(startInput.value).toBe("2026-11-02");
    expect(endInput.value).toBe("2026-11-02");
    expect(startInput.min).toBe("2026-11-02");
    expect(endInput.min).toBe("2026-11-02");
    // Neither input should be constrained by the other (that was the bug).
    expect(startInput.max).toBe("");
    expect(endInput.max).toBe("");
    expect(startInput.readOnly).toBe(false);
    expect(endInput.readOnly).toBe(false);
    expect(startInput.disabled).toBe(false);
    expect(endInput.disabled).toBe(false);

    // First Preview click fires one request and arms the auto-refresh.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    });
    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledTimes(1);
    });
    expect(previewSpy).toHaveBeenLastCalledWith("token", {
      startDate: "2026-11-02",
      endDate: "2026-11-02",
    });

    // Changing the start date to a later day auto-advances the end date
    // (the start > end auto-bump), and the preview re-fetches after the
    // 300ms debounce.
    await act(async () => {
      fireEvent.change(startInput, { target: { value: "2026-11-05" } });
    });
    expect(startInput.value).toBe("2026-11-05");
    expect(endInput.value).toBe("2026-11-05");

    await waitFor(
      () => {
        expect(previewSpy).toHaveBeenCalledWith("token", {
          startDate: "2026-11-05",
          endDate: "2026-11-05",
        });
      },
      { timeout: 2000 },
    );

    // Now extend the end date independently to 2026-11-07; start stays put.
    await act(async () => {
      fireEvent.change(endInput, { target: { value: "2026-11-07" } });
    });
    expect(startInput.value).toBe("2026-11-05");
    expect(endInput.value).toBe("2026-11-07");

    await waitFor(
      () => {
        expect(previewSpy).toHaveBeenCalledWith("token", {
          startDate: "2026-11-05",
          endDate: "2026-11-07",
        });
      },
      { timeout: 2000 },
    );

    // Moving the end date BEFORE the current start date auto-bumps the start
    // back, exercising the mirror auto-advance.
    await act(async () => {
      fireEvent.change(endInput, { target: { value: "2026-11-03" } });
    });
    expect(startInput.value).toBe("2026-11-03");
    expect(endInput.value).toBe("2026-11-03");

    await waitFor(
      () => {
        expect(previewSpy).toHaveBeenCalledWith("token", {
          startDate: "2026-11-03",
          endDate: "2026-11-03",
        });
      },
      { timeout: 2000 },
    );

    // The preview panel is still rendered after all these edits.
    expect(screen.getByRole("region", { name: /preview/i })).toBeTruthy();
  });
});
