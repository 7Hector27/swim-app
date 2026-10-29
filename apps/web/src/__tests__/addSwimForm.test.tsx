import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockUseActionState } = vi.hoisted(() => ({ mockUseActionState: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: mockUseActionState };
});

// Server-action calls are stubbed through useActionState; the real module
// pulls in next/headers which is not available in this test environment.
vi.mock("@/content/CoachSwimmerDetailContent/actions", () => ({
  addSwimForSwimmer: vi.fn(),
}));

import AddSwimForm from "../content/CoachSwimmerDetailContent/AddSwimForm";

const SWIMMER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const basePB = {
  eventDistance: 100,
  eventStroke: "free" as const,
  course: "scy" as const,
  timeHundredths: 6000, // 1:00.00
  timeString: "1:00.00",
  swimId: "11111111-0000-0000-0000-000000000001",
};

beforeEach(() => {
  mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
});

describe("AddSwimForm — digit-filling time preview", () => {
  it("shows the live-formatted time preview as digits are entered", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );

    const timeInput = screen.getByLabelText(/time/i);
    await user.type(timeInput, "10234");

    expect(screen.getByText("1:02.34")).toBeInTheDocument();
  });

  it("flags an invalid digit entry (seconds >= 60)", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );

    const timeInput = screen.getByLabelText(/time/i);
    await user.type(timeInput, "6000"); // 60.00 — invalid

    expect(screen.getByText(/invalid time/i)).toBeInTheDocument();
  });
});

describe("AddSwimForm — review step", () => {
  async function fillWithEvent(
    user: ReturnType<typeof userEvent.setup>,
    opts: { time: string; distance?: string },
  ) {
    if (opts.distance) {
      await user.selectOptions(screen.getByLabelText(/distance/i), opts.distance);
    }
    const timeInput = screen.getByLabelText(/time/i);
    await user.type(timeInput, opts.time);

    const dateInput = screen.getByLabelText(/date/i);
    await user.type(dateInput, "2025-06-15");

    await user.click(screen.getByRole("button", { name: /^review$/i }));
  }

  it("advances to a review summary showing swimmer, event, course, and time", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );

    await fillWithEvent(user, { time: "10234", distance: "100" });

    expect(screen.getByText(/^Review$/)).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("100 Free")).toBeInTheDocument();
    expect(screen.getByText("SCY")).toBeInTheDocument();
    expect(screen.getByText("1:02.34")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm & save/i })).toBeInTheDocument();
  });

  it("Edit from the review step returns to the edit form", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );

    await fillWithEvent(user, { time: "10234" });
    await user.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("button", { name: /^review$/i })).toBeInTheDocument();
  });
});

describe("AddSwimForm — deviation warning on review step", () => {
  async function fillAndReviewAt100(
    user: ReturnType<typeof userEvent.setup>,
    time: string,
  ) {
    await user.selectOptions(screen.getByLabelText(/distance/i), "100");
    const timeInput = screen.getByLabelText(/time/i);
    await user.type(timeInput, time);
    const dateInput = screen.getByLabelText(/date/i);
    await user.type(dateInput, "2025-06-15");
    await user.click(screen.getByRole("button", { name: /^review$/i }));
  }

  it("shows a warning when the entered time is >20% slower than the swimmer's PB", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[basePB]}
        onSuccess={() => {}}
      />,
    );
    // 1:30.00 (9000) is 50% slower than the 1:00.00 PB.
    await fillAndReviewAt100(user, "13000");

    const warning = screen.getByTestId("deviation-warning");
    expect(warning).toHaveTextContent(/slower/i);
    expect(warning).toHaveTextContent(/1:00.00/);
  });

  it("shows a warning when the entered time is >20% faster than the swimmer's PB", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[basePB]}
        onSuccess={() => {}}
      />,
    );
    // 40.00 (4000) is 33% faster than the 1:00.00 PB.
    await fillAndReviewAt100(user, "4000");

    const warning = screen.getByTestId("deviation-warning");
    expect(warning).toHaveTextContent(/faster/i);
  });

  it("does not warn when the entered time is within 20% of the PB", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[basePB]}
        onSuccess={() => {}}
      />,
    );
    // 1:05.00 is only ~8% slower than the 1:00.00 PB.
    await fillAndReviewAt100(user, "10500");

    expect(screen.queryByTestId("deviation-warning")).not.toBeInTheDocument();
  });

  it("does not warn when there is no prior PB for the event/course", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );
    await fillAndReviewAt100(user, "10000");

    expect(screen.queryByTestId("deviation-warning")).not.toBeInTheDocument();
  });
});

describe("AddSwimForm — meet mode requires a meet selection", () => {
  const meet = {
    id: "22222222-0000-0000-0000-000000000001",
    name: "Spring Invitational",
    meetDate: "2025-06-15",
    course: "scy" as const,
    swimCount: 0,
    createdAt: "2025-05-01T00:00:00Z",
    updatedAt: "2025-05-01T00:00:00Z",
  };

  it("keeps Review disabled when no meet is picked, and enables it after one is", async () => {
    const user = userEvent.setup();
    render(
      <AddSwimForm
        swimmerId={SWIMMER_ID}
        swimmerName="Alex"
        meets={[meet]}
        personalBests={[]}
        onSuccess={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/time/i), "10234");
    await user.type(screen.getByLabelText(/date/i), "2025-06-15");

    const reviewButton = screen.getByRole("button", { name: /^review$/i });
    expect(reviewButton).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/meet/i), meet.id);

    expect(reviewButton).toBeEnabled();
  });
});
