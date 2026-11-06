import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TimeSelect from "@/components/TimeSelect";
import { QUARTER_HOUR_OPTIONS } from "@/components/TimeSelect/timeOptions";

const INPUT_CLASS = "h-11 px-3 rounded-button border border-border";

describe("TimeSelect", () => {
  it("offers exactly the 96 quarter-hour options", () => {
    render(<TimeSelect id="t" value="" onChange={() => {}} className={INPUT_CLASS} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options)
      .map((option) => option.value)
      .filter((value) => value !== "");
    expect(values).toEqual([...QUARTER_HOUR_OPTIONS]);
    expect(values).toHaveLength(96);
  });

  it("loads an existing quarter-hour value as the selected option", () => {
    render(<TimeSelect id="t" value="09:00" onChange={() => {}} className={INPUT_CLASS} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("09:00");
    expect(screen.getByRole("option", { name: "9:00 AM", selected: true })).toBeTruthy();
  });

  it("renders an off-boundary value as-is without rounding it", () => {
    const onChange = vi.fn();
    render(<TimeSelect id="t" value="04:43" onChange={onChange} className={INPUT_CLASS} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("04:43");
    expect(screen.getByRole("option", { name: "4:43 AM", selected: true })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with a quarter-hour value when the user picks one", () => {
    const onChange = vi.fn();
    render(<TimeSelect id="t" value="04:43" onChange={onChange} className={INPUT_CLASS} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "04:45" } });
    expect(onChange).toHaveBeenCalledWith("04:45");
  });
});
