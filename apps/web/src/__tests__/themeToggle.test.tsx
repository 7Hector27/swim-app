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
  it("renders the same aria-label regardless of theme — no hydration mismatch", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Toggle color theme");

    mockTheme = "dark";
    render(<ThemeToggle />);
    expect(screen.getAllByRole("button")[1]).toHaveAttribute("aria-label", "Toggle color theme");
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
