import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import CoachWeekLessonCard from "@/components/CoachWeekLessonCard";
import type { CoachScheduleLessonItem } from "@swim-app/shared";

const LESSON_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SWIMMER_A = "bbbbbbbb-0000-4000-8000-000000000002";
const SWIMMER_B = "cccccccc-0000-4000-8000-000000000003";
// 4:00 PM PDT on 2026-06-01 → 23:00 UTC
const PAST_STARTS_AT = "2026-06-01T23:00:00.000Z";
const FUTURE_STARTS_AT = "2099-06-01T23:00:00.000Z";

// Pin "now" to one second after the past lesson start so hasStarted is true.
// Future lessons will stay in the future.
const NOW = new Date("2026-06-01T23:00:01.000Z");

function makeItem(overrides: Partial<CoachScheduleLessonItem["lesson"]> = {}): CoachScheduleLessonItem {
  return {
    type: "lesson",
    householdId: "dddddddd-0000-4000-8000-000000000004",
    locationName: "Egret Park",
    lesson: {
      id: LESSON_ID,
      householdId: "dddddddd-0000-4000-8000-000000000004",
      locationId: "eeeeeeee-0000-4000-8000-000000000005",
      startsAt: PAST_STARTS_AT,
      durationMinutes: 30,
      type: "private",
      status: "approved",
      swimmers: [{ swimmerId: SWIMMER_A, firstName: "Mia", lastName: "K", clubName: null }],
      expiresAt: null,
      approvedAt: PAST_STARTS_AT,
      declinedAt: null,
      declineReason: null,
      movedAt: null,
      previousStartsAt: null,
      createdAt: PAST_STARTS_AT,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CoachWeekLessonCard — content", () => {
  it("renders the time span and length on separate lines, plus swimmer first names and pool name", () => {
    render(<CoachWeekLessonCard item={makeItem()} />);
    expect(screen.getByText("4:00 to 4:30 PM")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("Mia")).toBeInTheDocument();
    expect(screen.getByText("Egret Park")).toBeInTheDocument();
  });

  it("joins multiple swimmer first names with a comma", () => {
    const item = makeItem({
      type: "family",
      swimmers: [
        { swimmerId: SWIMMER_A, firstName: "Mia", lastName: "K", clubName: null },
        { swimmerId: SWIMMER_B, firstName: "Theo", lastName: "K", clubName: null },
      ],
    });
    render(<CoachWeekLessonCard item={item} />);
    expect(screen.getByText("Mia, Theo")).toBeInTheDocument();
  });

  it("formats the time span across AM and PM boundaries without the length", () => {
    // 11:30 AM PDT → 18:30 UTC
    const item = makeItem({ startsAt: "2026-06-01T18:30:00.000Z", durationMinutes: 60 });
    render(<CoachWeekLessonCard item={item} />);
    expect(screen.getByText("11:30 AM to 12:30 PM")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });
});

describe("CoachWeekLessonCard — card link", () => {
  it("renders a single link to the coach lesson page covering the card", () => {
    render(<CoachWeekLessonCard item={makeItem({ startsAt: FUTURE_STARTS_AT })} />);
    const openLink = screen.getByRole("link", { name: /Open lesson\.?$/ });
    expect(openLink).toHaveAttribute("href", `/coach/lessons/${LESSON_ID}`);
  });

  it("includes the swimmer, time, length, and pool in the open-lesson aria-label", () => {
    render(<CoachWeekLessonCard item={makeItem({ startsAt: FUTURE_STARTS_AT })} />);
    const openLink = screen.getByRole("link", { name: /Open lesson\.?$/ });
    const label = openLink.getAttribute("aria-label") ?? "";
    expect(label).toContain("Mia");
    expect(label).toContain("4:00 to 4:30 PM");
    expect(label).toContain("30 min");
    expect(label).toContain("Egret Park");
  });
});

describe("CoachWeekLessonCard — status badge", () => {
  it("shows the Needs approval badge for a pending lesson", () => {
    render(
      <CoachWeekLessonCard item={makeItem({ startsAt: FUTURE_STARTS_AT, status: "pending" })} />,
    );
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
  });

  it("does not show the badge for an approved lesson", () => {
    render(
      <CoachWeekLessonCard item={makeItem({ startsAt: FUTURE_STARTS_AT, status: "approved" })} />,
    );
    expect(screen.queryByText("Needs approval")).toBeNull();
  });

  it("does not show the badge for completed, canceled, or declined states", () => {
    for (const status of ["completed", "canceled", "declined"] as const) {
      const { unmount } = render(
        <CoachWeekLessonCard item={makeItem({ startsAt: FUTURE_STARTS_AT, status })} />,
      );
      expect(screen.queryByText("Needs approval")).toBeNull();
      unmount();
    }
  });
});

describe("CoachWeekLessonCard — Evaluate control", () => {
  it("hides Evaluate for a future lesson that has not started", () => {
    render(<CoachWeekLessonCard item={makeItem({ startsAt: FUTURE_STARTS_AT })} />);
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Evaluate$/ })).toBeNull();
  });

  it("hides Evaluate for a canceled lesson even if it has started", () => {
    render(<CoachWeekLessonCard item={makeItem({ status: "canceled" })} />);
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Evaluate$/ })).toBeNull();
  });

  it("hides Evaluate for a declined lesson even if it has started", () => {
    render(<CoachWeekLessonCard item={makeItem({ status: "declined" })} />);
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Evaluate$/ })).toBeNull();
  });

  it("shows a direct Evaluate link for a single-swimmer started lesson", () => {
    render(<CoachWeekLessonCard item={makeItem()} />);
    const evaluateLink = screen.getByRole("link", { name: "Evaluate Mia" });
    expect(evaluateLink).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_A}/evaluate`);
  });

  it("renders an Evaluate menu button for a started lesson with multiple swimmers", () => {
    const item = makeItem({
      type: "family",
      swimmers: [
        { swimmerId: SWIMMER_A, firstName: "Mia", lastName: "K", clubName: null },
        { swimmerId: SWIMMER_B, firstName: "Theo", lastName: "K", clubName: null },
      ],
    });
    render(<CoachWeekLessonCard item={item} />);
    const button = screen.getByRole("button", { name: /^Evaluate$/ });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Menu is closed by default
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the menu and exposes a Link per swimmer when the button is clicked", () => {
    const item = makeItem({
      type: "family",
      swimmers: [
        { swimmerId: SWIMMER_A, firstName: "Mia", lastName: "K", clubName: null },
        { swimmerId: SWIMMER_B, firstName: "Theo", lastName: "K", clubName: null },
      ],
    });
    render(<CoachWeekLessonCard item={item} />);
    const button = screen.getByRole("button", { name: /^Evaluate$/ });
    fireEvent.click(button);

    const menu = screen.getByRole("menu");
    expect(button).toHaveAttribute("aria-expanded", "true");

    const miaItem = within(menu).getByRole("menuitem", { name: "Evaluate Mia" });
    const theoItem = within(menu).getByRole("menuitem", { name: "Evaluate Theo" });
    expect(miaItem).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_A}/evaluate`);
    expect(theoItem).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_B}/evaluate`);
  });
});

describe("CoachWeekLessonCard — anonymized (deleted-family) row", () => {
  // Household deletion anonymizes the lesson (swimmers=[], anonymizedAt
  // set, status flipped to canceled before anonymization). The coach
  // week view must render these as "Deleted family" with the cancelled
  // chip — not the generic "No swimmers" label with normal styling.
  const ANONYMIZED_AT = "2026-05-28T00:00:00.000Z";

  it("renders 'Deleted family' in place of the swimmer list", () => {
    render(
      <CoachWeekLessonCard
        item={makeItem({
          startsAt: FUTURE_STARTS_AT,
          status: "canceled",
          swimmers: [],
          anonymizedAt: ANONYMIZED_AT,
        })}
      />,
    );
    expect(screen.getByText("Deleted family")).toBeInTheDocument();
    expect(screen.queryByText("No swimmers")).toBeNull();
  });

  it("shows the Canceled chip for an anonymized row", () => {
    render(
      <CoachWeekLessonCard
        item={makeItem({
          startsAt: FUTURE_STARTS_AT,
          status: "canceled",
          swimmers: [],
          anonymizedAt: ANONYMIZED_AT,
        })}
      />,
    );
    expect(screen.getByText("Canceled")).toBeInTheDocument();
  });

  it("hides Evaluate for an anonymized row even if it has started", () => {
    render(
      <CoachWeekLessonCard
        item={makeItem({
          status: "canceled",
          swimmers: [],
          anonymizedAt: ANONYMIZED_AT,
        })}
      />,
    );
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Evaluate$/ })).toBeNull();
  });
});

describe("CoachWeekLessonCard — Evaluate does not trigger the card link", () => {
  it("renders the Evaluate link as a sibling of the open-lesson overlay, not a descendant", () => {
    render(<CoachWeekLessonCard item={makeItem()} />);
    const openLink = screen.getByRole("link", { name: /Open lesson\.?$/ });
    const evaluateLink = screen.getByRole("link", { name: "Evaluate Mia" });
    expect(openLink.contains(evaluateLink)).toBe(false);
    expect(evaluateLink.contains(openLink)).toBe(false);
  });

  it("renders the Evaluate menu button and items outside the open-lesson overlay", () => {
    const item = makeItem({
      type: "family",
      swimmers: [
        { swimmerId: SWIMMER_A, firstName: "Mia", lastName: "K", clubName: null },
        { swimmerId: SWIMMER_B, firstName: "Theo", lastName: "K", clubName: null },
      ],
    });
    render(<CoachWeekLessonCard item={item} />);
    const openLink = screen.getByRole("link", { name: /Open lesson\.?$/ });
    const button = screen.getByRole("button", { name: /^Evaluate$/ });
    expect(openLink.contains(button)).toBe(false);

    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    expect(openLink.contains(menu)).toBe(false);
    for (const menuItem of within(menu).getAllByRole("menuitem")) {
      expect(openLink.contains(menuItem)).toBe(false);
    }
  });
});
