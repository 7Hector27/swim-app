import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import SwimmerForm from "../components/SwimmerForm/SwimmerForm";
import type { Club } from "@swim-app/shared";

const CLUBS: Club[] = [
  {
    id: "club-1",
    name: "[Club 1]",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "club-2",
    name: "[Club 2]",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

const idleState = { status: "idle" as const };
const noop = vi.fn();

function getClubsJson(container: HTMLElement): unknown[] {
  const input = container.querySelector(
    'input[name="clubsJson"]',
  ) as HTMLInputElement;
  return JSON.parse(input.value) as unknown[];
}

function getTeamFieldset() {
  return screen.getByRole("group", { name: /swim club or team/i });
}

describe("SwimmerForm — clubs (add mode)", () => {
  it("No saves no club", () => {
    const { container } = render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    fireEvent.click(within(getTeamFieldset()).getByRole("radio", { name: "No" }));
    expect(getClubsJson(container)).toEqual([]);
  });

  it("Yes with a listed club saves that club's id", () => {
    const { container } = render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    fireEvent.click(within(getTeamFieldset()).getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "club-1" } });
    expect(getClubsJson(container)).toEqual([{ clubId: "club-1" }]);
  });

  it("Yes with Other and a name saves the other club name", () => {
    const { container } = render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    fireEvent.click(within(getTeamFieldset()).getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
    fireEvent.change(screen.getByPlaceholderText("Enter club or team name"), {
      target: { value: "Wave Riders" },
    });
    expect(getClubsJson(container)).toEqual([{ otherClubName: "Wave Riders" }]);
  });
});

describe("SwimmerForm — clubs (edit mode)", () => {
  it("editing changes the club to the new selection", () => {
    const { container } = render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="edit"
        swimmerId="swimmer-1"
        initialValues={{ clubs: [{ clubId: "club-1" }] }}
      />,
    );
    // Pre-populated: Yes + club-1 selected
    expect(getClubsJson(container)).toEqual([{ clubId: "club-1" }]);
    // Change to club-2
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "club-2" } });
    expect(getClubsJson(container)).toEqual([{ clubId: "club-2" }]);
  });
});
