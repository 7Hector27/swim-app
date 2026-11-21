import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimeInput from "@/components/TimeInput/TimeInput";

function Harness({
  initial = null,
  onEmit,
}: {
  initial?: number | null;
  onEmit?: (value: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <TimeInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onEmit?.(next);
      }}
    />
  );
}

describe("TimeInput — typing & auto-advance", () => {
  it("renders three labeled boxes grouped under the legend 'Time'", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Time" })).toBeInTheDocument();
    expect(screen.getByLabelText("Minutes")).toBeInTheDocument();
    expect(screen.getByLabelText("Seconds")).toBeInTheDocument();
    expect(screen.getByLabelText("Hundredths")).toBeInTheDocument();
  });

  it("boxes use inputmode='numeric'", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Minutes")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Seconds")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Hundredths")).toHaveAttribute("inputmode", "numeric");
  });

  it("typing two digits in minutes auto-advances to seconds", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const min = screen.getByLabelText("Minutes") as HTMLInputElement;
    const sec = screen.getByLabelText("Seconds") as HTMLInputElement;
    await user.click(min);
    await user.keyboard("12");
    expect(sec).toHaveFocus();
  });

  it("typing two digits in seconds auto-advances to hundredths", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sec = screen.getByLabelText("Seconds") as HTMLInputElement;
    const hun = screen.getByLabelText("Hundredths") as HTMLInputElement;
    await user.click(sec);
    await user.keyboard("34");
    expect(hun).toHaveFocus();
  });

  it("emits the correct hundredths for 1:02.34 entered box-by-box", async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    render(<Harness onEmit={emit} />);
    await user.click(screen.getByLabelText("Minutes"));
    await user.keyboard("1");
    await user.click(screen.getByLabelText("Seconds"));
    await user.keyboard("02");
    await user.click(screen.getByLabelText("Hundredths"));
    await user.keyboard("34");
    expect(emit).toHaveBeenLastCalledWith(6234);
  });
});

describe("TimeInput — paste and full-time fill", () => {
  it("pasting '1:02.34' into any box fills all three", () => {
    render(<Harness />);
    const sec = screen.getByLabelText("Seconds") as HTMLInputElement;
    sec.focus();
    fireEvent.paste(sec, { clipboardData: { getData: () => "1:02.34" } });
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("02");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("34");
  });

  it("pasting '32.41' fills seconds+hundredths; minutes stays 0", () => {
    render(<Harness />);
    const min = screen.getByLabelText("Minutes") as HTMLInputElement;
    min.focus();
    fireEvent.paste(min, { clipboardData: { getData: () => "32.41" } });
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("32");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("41");
  });

  it("pasting the digit string '10234' into any box fills every box as 1:02.34", () => {
    const emit = vi.fn();
    render(<Harness onEmit={emit} />);
    const min = screen.getByLabelText("Minutes") as HTMLInputElement;
    min.focus();
    fireEvent.paste(min, { clipboardData: { getData: () => "10234" } });
    expect(emit).toHaveBeenLastCalledWith(6234);
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("02");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("34");
  });
});

describe("TimeInput — nudge buttons wrap", () => {
  it("nudging seconds up from 59 wraps to 0", async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    render(<Harness initial={59 * 100} onEmit={emit} />);
    const up = screen.getByRole("button", { name: /increase seconds/i });
    await user.click(up);
    expect(emit).toHaveBeenLastCalledWith(0);
  });

  it("nudging hundredths down from 0 wraps to 99", async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    render(<Harness initial={0} onEmit={emit} />);
    const down = screen.getByRole("button", { name: /decrease hundredths/i });
    await user.click(down);
    expect(emit).toHaveBeenLastCalledWith(99);
  });

  it("arrow-up on seconds nudges by 1 and wraps", () => {
    const emit = vi.fn();
    render(<Harness initial={59 * 100} onEmit={emit} />);
    const sec = screen.getByLabelText("Seconds") as HTMLInputElement;
    sec.focus();
    fireEvent.keyDown(sec, { key: "ArrowUp" });
    expect(emit).toHaveBeenLastCalledWith(0);
  });
});

describe("TimeInput — empty is distinct from zero", () => {
  it("initial value=null renders all boxes empty", () => {
    render(<Harness initial={null} />);
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("");
  });

  it("initial value=0 renders 0:00.00", () => {
    render(<Harness initial={0} />);
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Seconds") as HTMLInputElement).value).toBe("00");
    expect((screen.getByLabelText("Hundredths") as HTMLInputElement).value).toBe("00");
  });

  it("clearing every box emits null, not 0", async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    render(<Harness initial={6234} onEmit={emit} />);
    const min = screen.getByLabelText("Minutes") as HTMLInputElement;
    const sec = screen.getByLabelText("Seconds") as HTMLInputElement;
    const hun = screen.getByLabelText("Hundredths") as HTMLInputElement;
    await user.clear(min);
    await user.clear(sec);
    await user.clear(hun);
    expect(emit).toHaveBeenLastCalledWith(null);
  });
});

describe("TimeInput — invalid seconds flagged but not silently coerced", () => {
  it("entering sec=60 leaves the box aria-invalid and does not emit a value", async () => {
    const user = userEvent.setup();
    const emit = vi.fn();
    render(<Harness onEmit={emit} />);
    const sec = screen.getByLabelText("Seconds") as HTMLInputElement;
    await user.click(sec);
    await user.keyboard("60");
    expect(sec).toHaveAttribute("aria-invalid", "true");
  });
});

describe("TimeInput — touch targets", () => {
  it("every text input is at least 44px tall and 44px wide", () => {
    render(<Harness />);
    for (const box of ["Minutes", "Seconds", "Hundredths"]) {
      const input = screen.getByLabelText(box) as HTMLInputElement;
      // h-11 is 2.75rem = 44px. min-w-[44px] ensures the floor.
      expect(input.className).toMatch(/h-11/);
      expect(input.className).toMatch(/min-w-\[44px\]/);
    }
  });
});
