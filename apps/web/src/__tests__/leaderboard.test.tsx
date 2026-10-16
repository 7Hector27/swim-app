import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import BoardTable from "@/components/BoardTable";
import type { PublicBoardRow, PublicMasterRow } from "@swim-app/shared";

const baseRow: PublicBoardRow = {
  firstName: "Maya",
  lastInitial: "R",
  ageGroup: "9-10",
  sex: "female",
  time: "0:28.45",
  eventDistance: 50,
  eventStroke: "free",
  course: "scy",
  rank: 1,
};

const secondRow: PublicBoardRow = {
  firstName: "Ethan",
  lastInitial: "K",
  ageGroup: "11-12",
  sex: "male",
  time: "0:29.10",
  eventDistance: 100,
  eventStroke: "back",
  course: "scy",
  rank: 2,
};

const tiedRow: PublicBoardRow = {
  firstName: "Liam",
  lastInitial: "T",
  ageGroup: "9-10",
  sex: "male",
  time: "0:28.45",
  eventDistance: 50,
  eventStroke: "free",
  course: "scy",
  rank: 1,
};

const masterRow: PublicMasterRow = {
  ...baseRow,
  standard: "AAA",
};

const secondMasterRow: PublicMasterRow = {
  ...secondRow,
  standard: "B",
};

describe("BoardTable", () => {
  it("renders empty state when rows is empty", () => {
    render(<BoardTable rows={[]} />);
    expect(
      screen.getByText("No times match those filters — try adjusting your selection."),
    ).toBeTruthy();
  });

  it("renders both swimmer names when given 2 rows", () => {
    render(<BoardTable rows={[baseRow, secondRow]} />);
    expect(screen.getByText("Maya R.")).toBeTruthy();
    expect(screen.getByText("Ethan K.")).toBeTruthy();
  });

  it("shows the same rank for tied rows", () => {
    render(<BoardTable rows={[baseRow, tiedRow]} />);
    const rankCells = screen.getAllByText("1");
    expect(rankCells.length).toBe(2);
  });

  it("never renders a full last name — only last initials", () => {
    render(<BoardTable rows={[baseRow, secondRow]} />);
    expect(screen.queryByText(/\bRoberts\b/)).toBeNull();
    expect(screen.queryByText(/\bKelly\b/)).toBeNull();
    expect(screen.getByText("Maya R.")).toBeTruthy();
    expect(screen.getByText("Ethan K.")).toBeTruthy();
  });

  it("does not render any swimmerId field in the DOM", () => {
    const rowWithNoId: PublicBoardRow = { ...baseRow };
    const { container } = render(<BoardTable rows={[rowWithNoId]} />);
    expect(container.innerHTML).not.toContain("swimmerId");
  });

  it("does not show Standard column header when showStandard is false", () => {
    render(<BoardTable rows={[masterRow, secondMasterRow]} showStandard={false} />);
    expect(screen.queryByText("Standard")).toBeNull();
  });

  it("shows Standard column header when showStandard is true", () => {
    render(<BoardTable rows={[masterRow, secondMasterRow]} showStandard={true} />);
    expect(screen.getByText("Standard")).toBeTruthy();
  });
});
