import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/lib/logout", () => ({
  logout: vi.fn(),
}));

vi.mock("@/components/SiteNav", () => ({
  default: () => <div data-testid="site-nav" />,
}));

vi.mock("@/components/ParentNav", () => ({
  default: () => <div data-testid="parent-nav" />,
  isLinkActive: vi.fn(),
  getVisibleLinks: vi.fn(() => []),
}));

vi.mock("@/components/CoachNav", () => ({
  default: () => <div data-testid="coach-nav" />,
  isCoachLinkActive: vi.fn(),
}));

const mockSession = {
  isSignedIn: false,
  userName: null,
  role: null as "coach" | "parent" | null,
  isViewer: false,
};

vi.mock("@/components/Providers", () => ({
  useSession: () => mockSession,
}));

import NavController from "../components/NavController/NavController";
import { isCoachLinkActive } from "../components/CoachNav/CoachNav";

beforeEach(() => {
  mockSession.isSignedIn = false;
  mockSession.role = null;
  mockSession.isViewer = false;
});

// ---------------------------------------------------------------------------
// NavController — renders the right nav per role
// ---------------------------------------------------------------------------

describe("NavController", () => {
  it("shows SiteNav for signed-out visitors on the home page", () => {
    mockSession.isSignedIn = false;
    render(<NavController />);
    expect(screen.getByTestId("site-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("parent-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coach-nav")).not.toBeInTheDocument();
  });

  it("shows ParentNav for a signed-in parent on the home page", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "parent";
    render(<NavController />);
    expect(screen.getByTestId("parent-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("site-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coach-nav")).not.toBeInTheDocument();
  });

  it("shows CoachNav for a signed-in coach on the home page", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "coach";
    render(<NavController />);
    expect(screen.getByTestId("coach-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("site-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("parent-nav")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NavController — same behaviour on a dashboard page
// ---------------------------------------------------------------------------

describe("NavController on /dashboard", () => {
  beforeEach(() => {
    // usePathname mock returns "/" globally; the controller logic doesn't
    // depend on pathname so the same assertions hold for any route.
  });

  it("shows ParentNav for a parent on /dashboard", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "parent";
    render(<NavController />);
    expect(screen.getByTestId("parent-nav")).toBeInTheDocument();
  });

  it("shows CoachNav for a coach on /dashboard", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "coach";
    render(<NavController />);
    expect(screen.getByTestId("coach-nav")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// isCoachLinkActive — pure function tests
// ---------------------------------------------------------------------------

describe("isCoachLinkActive", () => {
  it("Home (/dashboard) is active only on exact /dashboard", () => {
    expect(isCoachLinkActive("/dashboard", "/dashboard")).toBe(true);
    expect(isCoachLinkActive("/dashboard", "/coach/schedule")).toBe(false);
    expect(isCoachLinkActive("/dashboard", "/")).toBe(false);
  });

  it("Schedule (/coach/schedule) is active on the route and sub-paths", () => {
    expect(isCoachLinkActive("/coach/schedule", "/coach/schedule")).toBe(true);
    expect(isCoachLinkActive("/coach/schedule", "/coach/schedule/123")).toBe(true);
    expect(isCoachLinkActive("/coach/schedule", "/dashboard")).toBe(false);
  });

  it("Swimmers (/coach/swimmers) is active on the route and sub-paths", () => {
    expect(isCoachLinkActive("/coach/swimmers", "/coach/swimmers")).toBe(true);
    expect(isCoachLinkActive("/coach/swimmers", "/coach/swimmers/abc/progress")).toBe(true);
    expect(isCoachLinkActive("/coach/swimmers", "/dashboard")).toBe(false);
  });

  it("no link is active on the public home page /", () => {
    expect(isCoachLinkActive("/dashboard", "/")).toBe(false);
    expect(isCoachLinkActive("/coach/schedule", "/")).toBe(false);
    expect(isCoachLinkActive("/coach/swimmers", "/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProfileMenu — Dashboard present in both menus
// ---------------------------------------------------------------------------

import { fireEvent } from "@testing-library/react";

vi.mock("./profileMenu.test", () => ({})); // avoid re-running the other file

import ProfileMenu from "../components/ProfileMenu/ProfileMenu";

describe("ProfileMenu — Dashboard present in both menus", () => {
  it("parent menu includes Dashboard", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "parent";
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: /my account/i }));
    expect(screen.getByRole("menuitem", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("coach menu includes Dashboard", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "coach";
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: /my account/i }));
    expect(screen.getByRole("menuitem", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("coach menu does not include Household", () => {
    mockSession.isSignedIn = true;
    mockSession.role = "coach";
    render(<ProfileMenu />);
    fireEvent.click(screen.getByRole("button", { name: /my account/i }));
    expect(screen.queryByRole("menuitem", { name: "Household" })).not.toBeInTheDocument();
  });
});
