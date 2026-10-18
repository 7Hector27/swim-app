import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import SwimmerForm from "../components/SwimmerForm/SwimmerForm";
import type { Club } from "@swim-app/shared";

const CLUBS: Club[] = [
  {
    id: "club-nova",
    name: "Irvine Novaquatics (NOVA)",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "club-azot",
    name: "Aquazot Swim Club (AZOT)",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "club-mvn",
    name: "Mission Viejo Nadadores (MVN)",
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

function openClubPicker() {
  fireEvent.click(within(getTeamFieldset()).getByRole("radio", { name: "Yes" }));
  fireEvent.focus(screen.getByRole("combobox"));
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

  it("lists active clubs alphabetically with Other last", () => {
    render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    openClubPicker();
    const optionNames = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionNames).toEqual([
      "Aquazot Swim Club (AZOT)",
      "Irvine Novaquatics (NOVA)",
      "Mission Viejo Nadadores (MVN)",
      "Other (not listed)",
    ]);
  });

  it("typing filters the list", () => {
    render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    openClubPicker();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mvn" } });
    const optionNames = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionNames).toEqual(["Mission Viejo Nadadores (MVN)"]);
  });

  it("does not show placeholder clubs even if the component is passed only real ones", () => {
    render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    openClubPicker();
    expect(screen.queryByRole("option", { name: /\[Club/ })).toBeNull();
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
    openClubPicker();
    fireEvent.click(
      screen.getByRole("option", { name: "Aquazot Swim Club (AZOT)" }),
    );
    expect(getClubsJson(container)).toEqual([{ clubId: "club-azot" }]);
  });

  it("Yes with Other reveals the text field and saves the other club name", () => {
    const { container } = render(
      <SwimmerForm
        clubs={CLUBS}
        formAction={noop}
        state={idleState}
        isPending={false}
        mode="add"
      />,
    );
    openClubPicker();
    fireEvent.click(screen.getByRole("option", { name: "Other (not listed)" }));
    const otherInput = screen.getByPlaceholderText("Enter club or team name");
    fireEvent.change(otherInput, { target: { value: "Wave Riders" } });
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
        initialValues={{ clubs: [{ clubId: "club-nova" }] }}
      />,
    );
    expect(getClubsJson(container)).toEqual([{ clubId: "club-nova" }]);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(
      screen.getByRole("option", { name: "Mission Viejo Nadadores (MVN)" }),
    );
    expect(getClubsJson(container)).toEqual([{ clubId: "club-mvn" }]);
  });
});
