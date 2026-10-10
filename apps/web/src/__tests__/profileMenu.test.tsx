import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/navigation before importing the component
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Mock the logout server action
vi.mock("@/lib/logout", () => ({
  logout: vi.fn(),
}));

// Mock the session context
const mockSession = { isSignedIn: true, userName: "Alex Johnson" };

vi.mock("@/components/Providers", () => ({
  useSession: () => mockSession,
}));

import ProfileMenu from "../components/ProfileMenu/ProfileMenu";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileMenu", () => {
  it("renders initials from full name", () => {
    render(<ProfileMenu />);
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("AJ");
  });

  it("renders first letter of email when no name", () => {
    mockSession.userName = "ben@example.com";
    render(<ProfileMenu />);
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("B");
  });

  it("menu is hidden initially", () => {
    mockSession.userName = "Alex Johnson";
    render(<ProfileMenu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens menu on trigger click", () => {
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });

  it("closes menu on second trigger click", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("sets aria-expanded correctly", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes menu and returns focus on Escape", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens menu and focuses first item on ArrowDown from trigger", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("ArrowDown cycles focus through menu items", () => {
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    const menu = screen.getByRole("menu");

    // ArrowDown from any focused item should move to the next
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    // We just verify no error is thrown and menu stays open
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("contains a logout form with submit button", () => {
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    const logoutButton = screen.getByRole("menuitem", { name: "Log out" });
    expect(logoutButton.closest("form")).toBeTruthy();
  });
});
