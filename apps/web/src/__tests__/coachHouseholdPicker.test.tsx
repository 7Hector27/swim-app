// The coach household picker must render an InlineError (with retry) on a
// failed search — never collapse to "No households found." The two states
// are visually similar enough that a 5xx used to look like "no match."

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock("../content/CoachBookLessonContent/actions", () => ({
  searchHouseholdsAction: (q: string) => mockSearch(q),
  fetchHouseholdByIdAction: vi.fn(),
}));

import Step1HouseholdPicker from "../content/CoachBookLessonContent/Step1HouseholdPicker";

beforeEach(() => {
  mockSearch.mockReset();
});

function renderPicker(overrides: { initialQuery?: string } = {}) {
  const props = {
    initialHouseholds: [],
    initialQuery: overrides.initialQuery ?? "",
    selectedHousehold: null,
    selectedSwimmerIds: [],
    onSelectHousehold: vi.fn(),
    onToggleSwimmer: vi.fn(),
    onContinue: vi.fn(),
  };
  return render(<Step1HouseholdPicker {...props} />);
}

describe("Step1HouseholdPicker — search error", () => {
  it("shows InlineError (not 'No households found') on a failed search", async () => {
    mockSearch.mockResolvedValue({ ok: false, reason: "server" });
    renderPicker();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "smith" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't run that search/i);
    // Must not collapse to the empty-results copy.
    expect(screen.queryByText(/No households found/i)).toBeNull();
    // Retry button present.
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("retry re-runs the search", async () => {
    // First call fails; after retry the second call fires. We assert the
    // re-invocation rather than the final render — the debounce + async
    // settlement is covered by the other test in this suite.
    mockSearch.mockResolvedValue({ ok: false, reason: "server" });
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "smith" } });

    const retry = await screen.findByRole("button", { name: /try again/i });
    const callsBefore = mockSearch.mock.calls.length;
    fireEvent.click(retry);

    await waitFor(() => {
      expect(mockSearch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("shows 'No households found' only when the server returned ok + empty data", async () => {
    mockSearch.mockResolvedValue({ ok: true, data: [] });
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "smith" } });

    await waitFor(() => {
      expect(screen.getByText(/No households found/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
