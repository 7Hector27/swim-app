import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/components/ProfileMenu", () => ({
  default: () => <div data-testid="profile-menu" />,
}));

vi.mock("@/components/ThemeLogo", () => ({
  default: () => <div data-testid="theme-logo" />,
}));

vi.mock("@/components/ThemeToggle", () => ({
  default: () => <div data-testid="theme-toggle" />,
}));

vi.mock("@/lib/logout", () => ({
  logout: vi.fn(),
}));

import CoachNav, { isCoachLinkActive } from "../components/CoachNav/CoachNav";

function getBottomNav() {
  // Two navs share aria-label "Coach navigation": desktop header + mobile tab bar.
  // The tab bar is a <nav> element (not inside the header <nav>).
  const navs = screen.getAllByRole("navigation", { name: "Coach navigation" });
  // The bottom nav is the one rendered as a sibling to the header (not nested inside it).
  return navs[navs.length - 1]!;
}

describe("CoachNav — bottom tab bar has exactly 4 items", () => {
  it("renders Home, Schedule, Swimmers, and More tabs in the bottom bar", () => {
    render(<CoachNav />);
    const bottomNav = getBottomNav();
    expect(within(bottomNav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(bottomNav).getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(within(bottomNav).getByRole("link", { name: "Swimmers" })).toBeInTheDocument();
    expect(within(bottomNav).getByRole("button", { name: /more/i })).toBeInTheDocument();
  });

  it("bottom tab bar has exactly 4 interactive items", () => {
    render(<CoachNav />);
    const bottomNav = getBottomNav();
    const links = within(bottomNav).getAllByRole("link");
    const buttons = within(bottomNav).getAllByRole("button");
    expect(links.length + buttons.length).toBe(4);
  });

  it("Availability and Meets are not tab links in the bottom bar", () => {
    render(<CoachNav />);
    const bottomNav = getBottomNav();
    expect(within(bottomNav).queryByRole("link", { name: "Availability" })).not.toBeInTheDocument();
    expect(within(bottomNav).queryByRole("link", { name: "Meets" })).not.toBeInTheDocument();
  });
});

describe("CoachNav — More sheet", () => {
  it("sheet is not visible before More is clicked", () => {
    render(<CoachNav />);
    const dialog = document.querySelector("dialog[aria-label='More navigation options']") as HTMLDialogElement;
    expect(dialog).not.toHaveAttribute("open");
  });

  it("clicking More opens the sheet", () => {
    render(<CoachNav />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    const dialog = document.querySelector("dialog[aria-label='More navigation options']") as HTMLDialogElement;
    expect(dialog).toHaveAttribute("open");
  });

  it("sheet contains Meets, Availability, Account settings, Log out", () => {
    render(<CoachNav />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    const dialog = document.querySelector("dialog[aria-label='More navigation options']") as HTMLElement;
    expect(within(dialog).getByRole("link", { name: "Meets" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Availability" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Account settings" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("Close button closes the sheet", () => {
    render(<CoachNav />);
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const dialog = document.querySelector("dialog[aria-label='More navigation options']") as HTMLDialogElement;
    expect(dialog).not.toHaveAttribute("open");
  });

  it("More button has aria-haspopup=dialog and aria-expanded updates", () => {
    render(<CoachNav />);
    const btn = screen.getByRole("button", { name: /more/i });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });
});

describe("CoachNav — isCoachLinkActive (unchanged behaviour)", () => {
  it("marks /dashboard active only on exact match", () => {
    expect(isCoachLinkActive("/dashboard", "/dashboard")).toBe(true);
    expect(isCoachLinkActive("/dashboard", "/dashboard/other")).toBe(false);
  });

  it("marks /coach/schedule active for exact and subpaths", () => {
    expect(isCoachLinkActive("/coach/schedule", "/coach/schedule")).toBe(true);
    expect(isCoachLinkActive("/coach/schedule", "/coach/schedule/123")).toBe(true);
    expect(isCoachLinkActive("/coach/schedule", "/coach/availability")).toBe(false);
  });
});
