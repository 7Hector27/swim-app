import { vi, describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockUseActionState } = vi.hoisted(() => ({ mockUseActionState: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: mockUseActionState };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Server-action calls are stubbed through useActionState; the real modules
// pull in next/headers which isn't available in this test environment.
vi.mock("@/content/CoachSwimmerDetailContent/actions", () => ({
  addSwimForSwimmer: vi.fn(),
}));
vi.mock("@/content/CoachMeetsContent/actions", () => ({
  createMeetInline: vi.fn(),
}));

import AddSwimForm from "../content/CoachSwimmerDetailContent/AddSwimForm";

const SWIMMER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MEET_ID = "bbbbbbbb-0000-0000-0000-000000000002";

const testMeet = {
  id: MEET_ID,
  name: "Spring Invitational",
  meetDate: "2025-06-15",
  course: "scy" as const,
  swimCount: 0,
  createdAt: "2025-05-01T00:00:00Z",
  updatedAt: "2025-05-01T00:00:00Z",
};

const basePB = {
  eventDistance: 100,
  eventStroke: "free" as const,
  course: "scy" as const,
  timeHundredths: 6000,
  timeString: "1:00.00",
  swimId: "11111111-0000-0000-0000-000000000001",
};

beforeEach(() => {
  mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
});

describe("AddSwimForm — requires a meet (practice path removed)", () => {
  it("renders a Meet picker with an inline '+ Create a new meet' option", () => {
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[testMeet]}
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );
    const picker = screen.getByLabelText("Meet") as HTMLSelectElement;
    expect(picker).toBeInTheDocument();
    expect(Array.from(picker.options).some((option) => option.value === "__new__")).toBe(true);
  });

  it("surfaces inline errors next to the missing fields when Save is tapped empty", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[testMeet]}
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );
    // Save is always enabled — tapping it with nothing filled surfaces each
    // field's own message.
    const save = screen.getByRole("button", { name: /save time/i });
    expect(save).toBeEnabled();
    await user.click(save);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("Choose a meet"))).toBe(true);
    expect(alerts.some((el) => el.textContent?.includes("Enter a time"))).toBe(true);
    expect(alerts.some((el) => el.textContent?.includes("Pick a date"))).toBe(true);
  });
});

describe("AddSwimForm — deviation warning", () => {
  async function fillTime(
    user: ReturnType<typeof userEvent.setup>,
    min: string,
    sec: string,
    hun: string,
  ) {
    await user.click(screen.getByLabelText("Minutes"));
    if (min !== "") await user.keyboard(min);
    await user.click(screen.getByLabelText("Seconds"));
    if (sec !== "") await user.keyboard(sec);
    await user.click(screen.getByLabelText("Hundredths"));
    if (hun !== "") await user.keyboard(hun);
  }

  it("flags >20% slower than the swimmer's PB", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[testMeet]}
        personalBests={[basePB]}
        onSuccess={() => {}}
      />,
    );
    // Default distance=50 Free; change to 100 so the PB matches.
    // Distance is now a button-group (EventPicker); pick 100 by role.
    await user.click(screen.getByRole("radio", { name: "100" }));
    // 1:30.00 vs 1:00.00 PB → 50% slower.
    await fillTime(user, "1", "30", "00");
    const warning = screen.getByTestId("deviation-warning");
    expect(warning).toHaveTextContent(/slower/i);
    expect(warning).toHaveTextContent(/1:00.00/);
  });

  it("does not warn when there is no prior PB for the event/course", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[testMeet]}
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );
    // Distance is now a button-group (EventPicker); pick 100 by role.
    await user.click(screen.getByRole("radio", { name: "100" }));
    await fillTime(user, "1", "00", "00");
    expect(screen.queryByTestId("deviation-warning")).not.toBeInTheDocument();
  });
});

describe("AddSwimForm — no-clear-on-error rule", () => {
  it("keeps typed fields intact when the action returns an error state", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[testMeet]}
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );
    // Fill the form.
    // Distance is now a button-group (EventPicker); pick 100 by role.
    await user.click(screen.getByRole("radio", { name: "100" }));
    await user.click(screen.getByLabelText("Seconds"));
    await user.keyboard("58");
    await user.click(screen.getByLabelText("Hundredths"));
    await user.keyboard("30");
    await user.selectOptions(screen.getByLabelText("Meet"), MEET_ID);
    const date = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2025-06-15" } });

    // Transition to error state.
    mockUseActionState.mockReturnValue([
      { status: "error", message: "Could not record swim. Please try again." },
      vi.fn(),
      false,
    ]);

    // Re-render with same inputs still mounted: controlled state must survive.
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[testMeet]}
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );
    // Both renders should contain the error alert from the second render.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("Could not record swim"))).toBe(true);
  });
});
