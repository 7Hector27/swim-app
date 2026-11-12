// ADR 036 Phase 8 Part B Stop 3 piece 6: the Swimmers page hosts a
// Meets tab. These tests pin:
//   - Default tab is Swimmers; the panel renders the roster UI.
//   - `initialTab="meets"` opens the Meets panel directly (deep-link
//     path from the /coach/meets → /coach/swimmers?tab=meets redirect).
//   - Clicking the Meets tab switches the panel without a reload.

import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { CoachSwimmer, MeetResponse } from "@swim-app/shared";

// `CoachMeetsPanel` renders a client form that calls server actions;
// stub it to isolate the tab-swap behavior from the meets form internals.
vi.mock("@/content/CoachMeetsContent", () => ({
  CoachMeetsPanel: ({ meets }: { meets: MeetResponse[] }) => (
    <div data-testid="coach-meets-panel-stub">
      {meets.length === 0 ? "no meets" : `${meets.length} meets`}
    </div>
  ),
}));

import CoachRosterContent from "../content/CoachRosterContent/CoachRosterContent";

const swimmer: CoachSwimmer = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Alex",
  lastName: "Smith",
  age: 10,
  sex: "female",
  isPublic: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  clubs: [],
  currentLeagues: [],
  // `CoachSwimmer` also has household info we don't exercise here.
} as unknown as CoachSwimmer;

const meet: MeetResponse = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Fall Classic",
  meetDate: "2026-10-15",
  course: "scy",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
} as unknown as MeetResponse;

describe("Coach roster + meets tabs", () => {
  it("renders the Swimmers panel by default", () => {
    render(<CoachRosterContent swimmers={[swimmer]} meets={[meet]} initialTab="swimmers" />);
    const swimmersTab = screen.getByRole("tab", { name: "Swimmers" });
    const meetsTab = screen.getByRole("tab", { name: "Meets" });
    expect(swimmersTab).toHaveAttribute("aria-selected", "true");
    expect(meetsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("coach-swimmers-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("coach-meets-panel")).toBeNull();
  });

  it("opens the Meets panel when initialTab is meets (deep link)", () => {
    render(<CoachRosterContent swimmers={[swimmer]} meets={[meet]} initialTab="meets" />);
    expect(screen.getByRole("tab", { name: "Meets" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByTestId("coach-meets-panel");
    expect(within(panel).getByTestId("coach-meets-panel-stub")).toHaveTextContent("1 meets");
    expect(screen.queryByTestId("coach-swimmers-panel")).toBeNull();
  });

  it("switches panels when the Meets tab is clicked", () => {
    render(<CoachRosterContent swimmers={[swimmer]} meets={[meet]} initialTab="swimmers" />);
    fireEvent.click(screen.getByRole("tab", { name: "Meets" }));
    expect(screen.getByRole("tab", { name: "Meets" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("coach-meets-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("coach-swimmers-panel")).toBeNull();
  });
});
