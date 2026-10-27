import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import WeekNav, { type WeekNavDot } from "../content/BookCalendarContent/WeekNav";

// Any Monday that is not the "today" Monday — tests pin a static date pair so
// the current-week derivation is deterministic.
const TODAY = "2026-10-27"; // Tuesday
const MONDAY_THIS_WEEK = "2026-10-26";
const MONDAY_NEXT_WEEK = "2026-11-02";
const MONDAY_LAST_WEEK = "2026-10-19";

function baseDots(): WeekNavDot[] {
  return [
    { mondayStr: MONDAY_THIS_WEEK },
    { mondayStr: MONDAY_NEXT_WEEK },
    { mondayStr: "2026-11-09" },
  ];
}

// Dispatch a PointerEvent on an element. jsdom accepts PointerEvent in modern
// versions; fall back to constructing with MouseEvent + the pointer props
// grafted on so clientX/clientY arrive at the React handler.
function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { clientX: number; clientY: number; pointerId?: number; pointerType?: string },
) {
  const PointerEventCtor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as unknown as typeof PointerEvent);
  const event = new PointerEventCtor(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "touch",
    button: 0,
  });
  act(() => {
    element.dispatchEvent(event);
  });
}

describe("WeekNav", () => {
  it("Previous and Next buttons call the handlers", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_NEXT_WEEK}
        onPrev={onPrev}
        onNext={onNext}
        onToday={vi.fn()}
        todayStr={TODAY}
        dots={{ weeks: baseDots(), onJump: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("ArrowLeft and ArrowRight move the week when the nav is focused", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_NEXT_WEEK}
        onPrev={onPrev}
        onNext={onNext}
        onToday={vi.fn()}
        todayStr={TODAY}
        dots={{ weeks: baseDots(), onJump: vi.fn() }}
      />,
    );

    const group = screen.getByRole("group", { name: "Week navigation" });
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("blocks past weeks when disablePrev is set", () => {
    const onPrev = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_THIS_WEEK}
        onPrev={onPrev}
        onNext={vi.fn()}
        onToday={vi.fn()}
        todayStr={TODAY}
        disablePrev={true}
        dots={{ weeks: baseDots(), onJump: vi.fn() }}
      />,
    );
    const prev = screen.getByRole("button", { name: "Previous week" });
    expect(prev).toBeDisabled();

    const group = screen.getByRole("group", { name: "Week navigation" });
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("blocks beyond-window weeks when disableNext is set", () => {
    const onNext = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_LAST_WEEK}
        onPrev={vi.fn()}
        onNext={onNext}
        onToday={vi.fn()}
        todayStr={TODAY}
        disableNext={true}
        dots={{ weeks: baseDots(), onJump: vi.fn() }}
      />,
    );
    const next = screen.getByRole("button", { name: "Next week" });
    expect(next).toBeDisabled();

    const group = screen.getByRole("group", { name: "Week navigation" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onNext).not.toHaveBeenCalled();
  });

  it("tapping a dot jumps to that week", () => {
    const onJump = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_THIS_WEEK}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToday={vi.fn()}
        todayStr={TODAY}
        dots={{ weeks: baseDots(), onJump }}
      />,
    );
    // Dots are keyed by their short date. For 2026-11-02 that reads "Nov 2".
    const target = screen.getByRole("button", { name: "Jump to week of Nov 2" });
    fireEvent.click(target);
    expect(onJump).toHaveBeenCalledWith(MONDAY_NEXT_WEEK);
  });

  it("a vertical drag does not flip the week", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_NEXT_WEEK}
        onPrev={onPrev}
        onNext={onNext}
        onToday={vi.fn()}
        todayStr={TODAY}
        dots={{ weeks: baseDots(), onJump: vi.fn() }}
      />,
    );

    const swipeArea = screen.getByTestId("week-nav-swipe-area");
    firePointer(swipeArea, "pointerdown", { clientX: 100, clientY: 100 });
    // Finger moves straight down 150px — pure vertical scroll gesture.
    firePointer(swipeArea, "pointermove", { clientX: 100, clientY: 250 });
    firePointer(swipeArea, "pointerup", { clientX: 100, clientY: 250 });

    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("a horizontal drag past the commit threshold flips the week", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <WeekNav
        mondayStr={MONDAY_NEXT_WEEK}
        onPrev={onPrev}
        onNext={onNext}
        onToday={vi.fn()}
        todayStr={TODAY}
        dots={{ weeks: baseDots(), onJump: vi.fn() }}
      />,
    );

    const swipeArea = screen.getByTestId("week-nav-swipe-area");
    // Drag 100px to the right — more than 60px commit distance, clearly
    // horizontal — commits to Previous week.
    firePointer(swipeArea, "pointerdown", { clientX: 100, clientY: 100 });
    firePointer(swipeArea, "pointermove", { clientX: 200, clientY: 100 });
    firePointer(swipeArea, "pointerup", { clientX: 200, clientY: 100 });

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });
});
