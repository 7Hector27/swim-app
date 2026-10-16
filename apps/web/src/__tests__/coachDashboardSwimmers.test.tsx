import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import SwimmersTable from "../content/CoachDashboardContent/SwimmersTable";
import type { CoachSwimmer } from "@swim-app/shared";

function makeSwimmer(overrides: Partial<CoachSwimmer> & { id: string }): CoachSwimmer {
  return {
    firstName: "Alex",
    lastName: "Smith",
    age: 10,
    sex: "female",
    isPublic: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    clubs: [],
    currentLeagues: [],
    memberNames: ["Jordan Smith"],
    ...overrides,
  };
}

const swimmers: CoachSwimmer[] = [
  makeSwimmer({ id: "id-1", firstName: "Alex", lastName: "Smith", age: 10, memberNames: ["Jordan Smith"], isPublic: false }),
  makeSwimmer({ id: "id-2", firstName: "Riley", lastName: "Jones", age: 8, memberNames: ["Casey Jones"], isPublic: true }),
];

describe("SwimmersTable — phone layout (mobile list)", () => {
  it("renders a list item for each swimmer", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
  });

  it("shows swimmer name in the mobile list", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    // getAllByText because name also appears in the desktop table
    const names = screen.getAllByText("Alex Smith");
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  it("shows swimmer age in the mobile list", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const ageLabels = screen.getAllByText("Age 10");
    expect(ageLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Public badge for public swimmers in the mobile list", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const badges = screen.getAllByText("Public");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Private badge for private swimmers in the mobile list", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const badges = screen.getAllByText("Private");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows parent name as secondary text in the mobile list", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const parentTexts = screen.getAllByText("Jordan Smith");
    expect(parentTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("Open links in mobile list point to the swimmer detail page", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const openLinks = screen.getAllByRole("link", { name: "Open" });
    // One link per swimmer in the mobile list (plus duplicates in desktop table)
    expect(openLinks.length).toBeGreaterThanOrEqual(2);
    const hrefs = openLinks.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/coach/swimmers/id-1");
    expect(hrefs).toContain("/coach/swimmers/id-2");
  });

  it("shows empty state in mobile list when search has no results", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "zzznomatch" } });
    const emptyMessages = screen.getAllByText("No swimmers match your search.");
    expect(emptyMessages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SwimmersTable — search", () => {
  it("filters by swimmer name", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Riley" } });
    expect(screen.queryByText("Alex Smith")).toBeNull();
    expect(screen.getAllByText("Riley Jones").length).toBeGreaterThanOrEqual(1);
  });

  it("filters by parent name", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Casey" } });
    expect(screen.queryByText("Alex Smith")).toBeNull();
    expect(screen.getAllByText("Riley Jones").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SwimmersTable — desktop table", () => {
  it("renders a table with swimmer data", () => {
    render(<SwimmersTable swimmers={swimmers} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });
});
