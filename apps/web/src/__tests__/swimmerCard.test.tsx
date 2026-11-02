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
  clubName: null,
  nextLessonLine: null,
  lastEvaluatedLabel: null,
  bestEvent: null,
  onLeaderboards: false,
  removeAction: mockRemoveAction,
};

describe("SwimmerCard", () => {
  it("renders swimmer name and the Age subheader", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.getByText("Morgan Lee")).toBeInTheDocument();
    expect(screen.getByText("Age 10")).toBeInTheDocument();
  });

  it("appends the club name to the subheader when provided", () => {
    render(<SwimmerCard {...baseProps} clubName="Dragon Swim Club" />);
    expect(screen.getByText("Age 10 \u00B7 Dragon Swim Club")).toBeInTheDocument();
  });

  it("renders the next lesson line when provided", () => {
    render(<SwimmerCard {...baseProps} nextLessonLine="Thu at 4:30 PM" />);
    expect(screen.getByText(/Next lesson/i)).toBeInTheDocument();
    expect(screen.getByText(/Thu at 4:30 PM/i)).toBeInTheDocument();
  });

  it("shows 'No upcoming lessons' when there is no next lesson", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.getByText(/No upcoming lessons/i)).toBeInTheDocument();
  });

  it("renders the last-evaluated line when provided", () => {
    render(<SwimmerCard {...baseProps} lastEvaluatedLabel="2 weeks ago" />);
    expect(screen.getByText(/Last evaluated 2 weeks ago/i)).toBeInTheDocument();
  });

  it("hides the last-evaluated line when there is none", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.queryByText(/Last evaluated/i)).not.toBeInTheDocument();
  });

  it("shows the On leaderboards pill when onLeaderboards is true", () => {
    render(<SwimmerCard {...baseProps} onLeaderboards={true} />);
    expect(screen.getByText("On leaderboards")).toBeInTheDocument();
  });

  it("hides the On leaderboards pill when onLeaderboards is false", () => {
    render(<SwimmerCard {...baseProps} onLeaderboards={false} />);
    expect(screen.queryByText("On leaderboards")).not.toBeInTheDocument();
  });

  it("renders the best-event line when bestEvent is provided", () => {
    render(
      <SwimmerCard
        {...baseProps}
        bestEvent={{ label: "50 Free", timeString: "32.15" }}
      />,
    );
    expect(screen.getByText("Best 50 Free")).toBeInTheDocument();
    expect(screen.getByText("32.15")).toBeInTheDocument();
  });

  it("hides the best-event line when bestEvent is null", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.queryByText(/^Best /)).not.toBeInTheDocument();
  });

  it("does not render the removed Profile row or Share stats button", () => {
    render(<SwimmerCard {...baseProps} />);
    expect(screen.queryByText(/^Public$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Private$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /share stats/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("View progress link points to the progress page", () => {
    render(<SwimmerCard {...baseProps} />);
    const link = screen.getByRole("link", { name: /view progress/i });
    expect(link).toHaveAttribute("href", "/dashboard/swimmers/swimmer-abc/progress");
  });

  it("View profile link points to the profile page", () => {
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
