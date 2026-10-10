import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockSetTheme = vi.fn();
let mockTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

import ThemeToggle from "../components/ThemeToggle/ThemeToggle";

beforeEach(() => {
  vi.clearAllMocks();
  mockTheme = "light";
});

describe("ThemeToggle", () => {
  it("shows 'Switch to dark theme' aria-label in light mode", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Switch to dark theme",
    );
  });

  it("shows 'Switch to light theme' aria-label in dark mode", () => {
    mockTheme = "dark";
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Switch to light theme",
    );
  });

  it("calls setTheme('dark') when clicked in light mode", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("calls setTheme('light') when clicked in dark mode", () => {
    mockTheme = "dark";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });
});
