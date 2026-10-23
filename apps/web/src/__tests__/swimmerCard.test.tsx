import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { RemoveSwimmerState } from "../content/ParentDashboardContent/actions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// jsdom doesn't implement HTMLDialogElement methods
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.clearAllMocks();
});

import SwimmerCard from "../content/ParentDashboardContent/SwimmerCard";

const mockRemoveAction = vi.fn() as unknown as (
  _prevState: RemoveSwimmerState,
  _formData: FormData,
) => Promise<RemoveSwimmerState>;

const baseProps = {
  id: "swimmer-abc",
  firstName: "Morgan",
  lastName: "Lee",
  age: 10,
  isPublic: false,
  removeAction: mockRemoveAction,
};

describe("SwimmerCard", () => {
  it("renders swimmer name and age", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.getByText("Morgan Lee")).toBeInTheDocument();
    expect(screen.getByText("Age 10")).toBeInTheDocument();
  });

  it("shows Public when isPublic is true", () => {
    render(<SwimmerCard {...baseProps} isPublic={true} />);
    expect(screen.getByText("Public")).toBeInTheDocument();
  });

  it("shows Private when isPublic is false", () => {
    render(<SwimmerCard {...baseProps} isPublic={false} />);
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("view profile link points to the correct page", () => {
    render(<SwimmerCard {...baseProps} />);
    const link = screen.getByRole("link", { name: /view profile/i });
    expect(link).toHaveAttribute("href", "/dashboard/swimmers/swimmer-abc");
  });

  it("overflow menu is hidden initially", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("overflow menu opens on trigger click", () => {
    render(<SwimmerCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /more options for morgan/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /remove morgan/i })).toBeInTheDocument();
  });

  it("overflow menu closes on Escape", () => {
    render(<SwimmerCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /more options for morgan/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("overflow trigger sets aria-expanded correctly", () => {
    render(<SwimmerCard {...baseProps} />);
    const trigger = screen.getByRole("button", { name: /more options for morgan/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking Remove calls showModal and closes overflow", () => {
    render(<SwimmerCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /more options for morgan/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /remove morgan/i }));

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not render any parent or guardian name on the card", () => {
    render(<SwimmerCard {...baseProps} />);
    // Swimmer cards show only swimmer data; parent/guardian names must not appear
    expect(screen.getByText("Morgan Lee")).toBeInTheDocument();
    expect(screen.queryByText(/parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/guardian/i)).not.toBeInTheDocument();
  });

  it("persistent remove form is always in the DOM", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(document.getElementById("remove-swimmer-swimmer-abc")).toBeInTheDocument();
  });

  it("confirm button always references the remove form", () => {
    render(<SwimmerCard {...baseProps} />);
    const confirmButton = screen.getByRole("button", { name: "Remove", hidden: true });
    expect(confirmButton).toHaveAttribute("type", "submit");
    expect(confirmButton).toHaveAttribute("form", "remove-swimmer-swimmer-abc");
  });
});
