import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type SwimStroke, VALID_EVENTS } from "@swim-app/shared";

import EventPicker from "@/components/EventPicker/EventPicker";

function Harness({
  initialStroke = "free" as SwimStroke,
  initialDistance,
  onEmit,
}: {
  initialStroke?: SwimStroke;
  initialDistance?: number;
  onEmit?: (stroke: SwimStroke, distance: number) => void;
}) {
  const [stroke, setStroke] = useState<SwimStroke>(initialStroke);
  const [distance, setDistance] = useState<number>(
    initialDistance ?? VALID_EVENTS[initialStroke][0] ?? 50,
  );
  return (
    <EventPicker
      stroke={stroke}
      distance={distance}
      onStrokeChange={(next) => {
        setStroke(next);
        onEmit?.(next, distance);
      }}
      onDistanceChange={(next) => {
        setDistance(next);
        onEmit?.(stroke, next);
      }}
    />
  );
}

describe("EventPicker", () => {
  it("renders all 5 stroke buttons", () => {
    render(<Harness />);
    for (const label of ["Free", "Back", "Breast", "Fly", "IM"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("shows only distances valid for the chosen stroke", () => {
    render(<Harness initialStroke="im" />);
    const imDistances = VALID_EVENTS.im;
    const allPossibleDistances = Array.from(
      new Set(Object.values(VALID_EVENTS).flat()),
    );
    const notValidForIM = allPossibleDistances.filter((value) => !imDistances.includes(value));
    for (const value of imDistances) {
      expect(screen.getByRole("radio", { name: String(value) })).toBeInTheDocument();
    }
    for (const value of notValidForIM) {
      expect(
        screen.queryByRole("radio", { name: String(value) }),
      ).not.toBeInTheDocument();
    }
  });

  it("switches to the first valid distance when the current distance isn't valid for the new stroke", async () => {
    const user = userEvent.setup();
    // Start at 1500 Free (valid) then tap Fly (which does NOT include 1500).
    render(<Harness initialStroke="free" initialDistance={1500} />);
    expect(screen.getByRole("radio", { name: "1500", checked: true })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Fly" }));
    const firstFly = VALID_EVENTS.fly[0]!;
    expect(screen.getByRole("radio", { name: String(firstFly), checked: true })).toBeInTheDocument();
  });

  it("keeps the current distance when it IS valid for the new stroke", async () => {
    const user = userEvent.setup();
    // 100 is valid for Free AND Back.
    render(<Harness initialStroke="free" initialDistance={100} />);
    await user.click(screen.getByRole("radio", { name: "Back" }));
    expect(screen.getByRole("radio", { name: "100", checked: true })).toBeInTheDocument();
  });

  it("buttons meet the 44px touch target", () => {
    render(<Harness />);
    const stroke = screen.getByRole("radio", { name: "Free" });
    const distance = screen.getByRole("radio", { name: String(VALID_EVENTS.free[0]) });
    expect(stroke.className).toMatch(/min-h-\[44px\]/);
    expect(distance.className).toMatch(/min-h-\[44px\]/);
  });

  it("emits new stroke on tap", async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    render(<Harness onEmit={emit} />);
    await user.click(screen.getByRole("radio", { name: "Back" }));
    expect(emit).toHaveBeenCalled();
    const [newStroke] = emit.mock.calls[0]!;
    expect(newStroke).toBe("back");
  });
});
