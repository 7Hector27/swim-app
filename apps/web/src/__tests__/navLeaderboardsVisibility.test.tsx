import { describe, expect, it, vi, beforeEach } from "vitest";
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

vi.mock("@/components/Providers", () => ({
  useSession: () => ({ isViewer: false, role: "parent", isSignedIn: true }),
}));

vi.mock("@/components/ThemeLogo", () => ({ default: () => <div /> }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => <div /> }));
vi.mock("@/components/CoachNotificationBell", () => ({ default: () => <div /> }));
vi.mock("@/components/BookGate", () => ({
  BookLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/logout", () => ({ logout: vi.fn() }));

import CoachNav from "../components/CoachNav/CoachNav";
import ParentNav from "../components/ParentNav/ParentNav";

describe("ParentNav — Leaderboards visibility", () => {
  it("renders the Leaderboards desktop link when at least one board qualifies", () => {
    render(<ParentNav hasAnyBoard={true} />);
    const nav = screen.getAllByRole("navigation", { name: /parent navigation/i })[0]!;
    expect(within(nav).getByRole("link", { name: "Leaderboards" })).toBeInTheDocument();
  });

  it("hides the Leaderboards desktop link when no board qualifies", () => {
    render(<ParentNav hasAnyBoard={false} />);
    const nav = screen.getAllByRole("navigation", { name: /parent navigation/i })[0]!;
    expect(within(nav).queryByRole("link", { name: "Leaderboards" })).toBeNull();
  });
});

describe("CoachNav — Leaderboards visibility", () => {
  it("renders Leaderboards in the desktop nav and the More sheet when at least one board qualifies", () => {
    render(<CoachNav hasAnyBoard={true} />);
    const desktopNav = screen.getAllByRole("navigation", { name: /coach navigation/i })[0]!;
    expect(within(desktopNav).getByRole("link", { name: "Leaderboards" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    const dialog = document.querySelector("dialog[aria-label='More navigation options']") as HTMLElement;
    expect(within(dialog).getByRole("link", { name: "Leaderboards" })).toBeInTheDocument();
  });

  it("hides Leaderboards everywhere when no board qualifies", () => {
    render(<CoachNav hasAnyBoard={false} />);
    const desktopNav = screen.getAllByRole("navigation", { name: /coach navigation/i })[0]!;
    expect(within(desktopNav).queryByRole("link", { name: "Leaderboards" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    const dialog = document.querySelector("dialog[aria-label='More navigation options']") as HTMLElement;
    expect(within(dialog).queryByRole("link", { name: "Leaderboards" })).toBeNull();
  });
});
