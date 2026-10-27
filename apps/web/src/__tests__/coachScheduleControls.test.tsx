import { vi, describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockPush = vi.fn();
const mockPrefetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    prefetch: mockPrefetch,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/coach/schedule",
}));

import CoachScheduleControls from "@/content/CoachScheduleContent/CoachScheduleControls";

const DAY = "2026-10-20";
const PREV_DAY = "2026-10-19";
const NEXT_DAY = "2026-10-21";
const WEEK_MONDAY = "2026-10-19";
const PREV_WEEK_MONDAY = "2026-10-12";
const NEXT_WEEK_MONDAY = "2026-10-26";
const TODAY = "2026-10-20";
const TODAY_MONDAY = "2026-10-19";

function renderControls(view: "day" | "week" = "day") {
  return render(
    <CoachScheduleControls
      date={view === "day" ? DAY : WEEK_MONDAY}
      view={view}
      today={TODAY}
      weekMonday={WEEK_MONDAY}
      todayMonday={TODAY_MONDAY}
      prevDay={PREV_DAY}
      nextDay={NEXT_DAY}
      prevWeekMonday={PREV_WEEK_MONDAY}
      nextWeekMonday={NEXT_WEEK_MONDAY}
      dayLabel="Today"
      weekLabel="Oct 19 to 25"
    >
      <div data-testid="schedule-content">lessons here</div>
    </CoachScheduleControls>,
  );
}

beforeEach(() => {
  mockPush.mockReset();
  mockPrefetch.mockReset();
});

describe("CoachScheduleControls", () => {
  it("renders Day as the active toggle on day view", () => {
    renderControls("day");
    const dayLink = screen.getByRole("link", { name: "Day" });
    const weekLink = screen.getByRole("link", { name: "Week" });
    expect(dayLink).toHaveAttribute("aria-current", "page");
    expect(weekLink).not.toHaveAttribute("aria-current");
  });

  it("prefetches the sibling view and adjacent days on mount in day view", () => {
    renderControls("day");
    const calls = mockPrefetch.mock.calls.map((call) => call[0] as string);
    expect(calls).toContain(`/coach/schedule?view=week&date=${WEEK_MONDAY}`);
    expect(calls).toContain(`/coach/schedule?view=day&date=${PREV_DAY}`);
    expect(calls).toContain(`/coach/schedule?view=day&date=${NEXT_DAY}`);
  });

  it("prefetches the sibling view and adjacent weeks on mount in week view", () => {
    renderControls("week");
    const calls = mockPrefetch.mock.calls.map((call) => call[0] as string);
    expect(calls).toContain(`/coach/schedule?view=day&date=${WEEK_MONDAY}`);
    expect(calls).toContain(`/coach/schedule?view=week&date=${PREV_WEEK_MONDAY}`);
    expect(calls).toContain(`/coach/schedule?view=week&date=${NEXT_WEEK_MONDAY}`);
  });

  it("flips aria-current to Week immediately when Week is clicked, before navigation resolves", async () => {
    // Make router.push suspend so useTransition stays pending.
    let resolvePush: (() => void) | undefined;
    mockPush.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePush = resolve; }),
    );

    renderControls("day");
    const dayLink = screen.getByRole("link", { name: "Day" });
    const weekLink = screen.getByRole("link", { name: "Week" });

    expect(dayLink).toHaveAttribute("aria-current", "page");

    await act(async () => {
      fireEvent.click(weekLink);
    });

    expect(weekLink).toHaveAttribute("aria-current", "page");
    expect(dayLink).not.toHaveAttribute("aria-current");
    expect(mockPush).toHaveBeenCalledWith(`?view=week&date=${WEEK_MONDAY}`);

    await act(async () => {
      resolvePush?.();
    });
  });

  it("marks the content wrapper aria-busy while the transition is pending", async () => {
    let resolvePush: (() => void) | undefined;
    mockPush.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePush = resolve; }),
    );

    renderControls("day");

    const content = screen.getByTestId("schedule-content");
    const wrapper = content.parentElement as HTMLElement;
    expect(wrapper).not.toHaveAttribute("aria-busy");
    expect(wrapper.className).toContain("opacity-100");

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Week" }));
    });

    expect(wrapper).toHaveAttribute("aria-busy", "true");
    expect(wrapper.className).toContain("opacity-60");

    await act(async () => {
      resolvePush?.();
    });
  });

  it("navigates via router.push on prev/next day clicks instead of letting the browser follow the link", async () => {
    renderControls("day");

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Previous day" }));
    });
    expect(mockPush).toHaveBeenCalledWith(`?view=day&date=${PREV_DAY}`);

    mockPush.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Next day" }));
    });
    expect(mockPush).toHaveBeenCalledWith(`?view=day&date=${NEXT_DAY}`);
  });

  it("navigates via router.push on prev/next week clicks in week view", async () => {
    renderControls("week");

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Previous week" }));
    });
    expect(mockPush).toHaveBeenCalledWith(`?view=week&date=${PREV_WEEK_MONDAY}`);

    mockPush.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Next week" }));
    });
    expect(mockPush).toHaveBeenCalledWith(`?view=week&date=${NEXT_WEEK_MONDAY}`);
  });

  it("does not preventDefault on modifier-click so cmd/ctrl+click still open a new tab", () => {
    renderControls("day");
    const weekLink = screen.getByRole("link", { name: "Week" });

    fireEvent.click(weekLink, { metaKey: true });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
