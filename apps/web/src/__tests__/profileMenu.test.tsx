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

const mockSession = {
  isSignedIn: true,
  userName: "Jane Doe",
  role: "parent" as "coach" | "parent" | null,
  isViewer: false,
};

vi.mock("@/components/Providers", () => ({
  useSession: () => mockSession,
}));

import ProfileMenu from "../components/ProfileMenu/ProfileMenu";

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.role = "parent";
  mockSession.isViewer = false;
});

describe("ProfileMenu — parent", () => {
  it("renders My account trigger button", () => {
    render(<ProfileMenu />);
    expect(screen.getByRole("button", { name: /my account/i })).toBeInTheDocument();
  });

  it("menu is hidden initially", () => {
    render(<ProfileMenu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens and shows Household + Account settings for a parent", () => {
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: /my account/i }));
    expect(screen.getByRole("menuitem", { name: "Household" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("closes menu on second trigger click", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: /my account/i });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("sets aria-expanded correctly", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: /my account/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes menu and returns focus on Escape", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: /my account/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens menu and focuses first item on ArrowDown from trigger", () => {
    render(<ProfileMenu />);
    const trigger = screen.getByRole("button", { name: /my account/i });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("log out button references the persistent logout form", () => {
    render(<ProfileMenu />);
    expect(document.getElementById("logout-form")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /my account/i }));
    const logoutButton = screen.getByRole("menuitem", { name: "Log out" });
    expect(logoutButton).toHaveAttribute("form", "logout-form");
    expect(logoutButton).toHaveAttribute("type", "submit");
  });
});

describe("ProfileMenu — coach", () => {
  it("shows Dashboard + Account settings for a coach", () => {
    mockSession.role = "coach";
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: /my account/i }));
    expect(screen.getByRole("menuitem", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Household" })).not.toBeInTheDocument();
  });
});
