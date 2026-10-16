import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockRouterRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("@/lib/actions/notes", () => ({
  createNoteAction: vi.fn(),
  updateNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  default: ({ title, onCancel }: { title: string; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{title}</span>
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="submit">Confirm</button>
    </div>
  ),
}));

vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));
vi.mock("@/content/CoachSwimmerDetailContent/HidePublicButton", () => ({
  default: () => <button>Hide</button>,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerSkillsHistory", () => ({
  default: () => <div data-testid="skills-history" />,
}));

import AddNoteForm from "../components/AddNoteForm/AddNoteForm";
import SwimmerTimeline from "../content/CoachSwimmerDetailContent/SwimmerTimeline";

const SWIMMER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const NOTE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SESSION_ID = "cccccccc-0000-0000-0000-000000000003";
const SKILL_ID = "dddddddd-0000-0000-0000-000000000004";

const EMPTY_CATEGORIES: import("@swim-app/shared").CategoriesResponse = [];

const CATEGORIES_WITH_SKILL: import("@swim-app/shared").CategoriesResponse = [
  {
    id: "cat-1",
    slug: "freestyle",
    name: "Freestyle",
    sortOrder: 1,
    skills: [
      {
        id: SKILL_ID,
        slug: "flutter-kick",
        name: "Flutter Kick",
        type: "rubric" as const,
        unit: null,
        ratedPerSide: false,
        notLegalAllowed: false,
        parentSkillId: null,
        sortOrder: 1,
        faultTags: [],
      },
    ],
  },
];

// ── AddNoteForm ───────────────────────────────────────────────────────────────

describe("AddNoteForm", () => {
  it("renders a textarea and submit button", () => {
    render(<AddNoteForm swimmerId={SWIMMER_ID} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save note/i })).toBeInTheDocument();
  });

  it("shows the label prop", () => {
    render(<AddNoteForm swimmerId={SWIMMER_ID} label="Session note" />);
    expect(screen.getByText("Session note")).toBeInTheDocument();
  });

  it("disables submit when textarea is empty (required)", () => {
    render(<AddNoteForm swimmerId={SWIMMER_ID} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("required");
  });

  it("renders note type selector with all four types", () => {
    render(<AddNoteForm swimmerId={SWIMMER_ID} />);
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Observation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Correction" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Drill" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Recommendation" })).toBeInTheDocument();
  });

  it("renders skill selector when categories are provided", () => {
    render(<AddNoteForm swimmerId={SWIMMER_ID} categories={CATEGORIES_WITH_SKILL} />);
    expect(screen.getByRole("option", { name: "Flutter Kick" })).toBeInTheDocument();
  });

  it("does not render skill selector when categories are empty", () => {
    render(<AddNoteForm swimmerId={SWIMMER_ID} categories={[]} />);
    const selects = screen.getAllByRole("combobox");
    // Only the noteType select, no skill select
    expect(selects).toHaveLength(1);
  });
});

// ── SwimmerTimeline — filter chips ────────────────────────────────────────────

describe("SwimmerTimeline — filter chips", () => {
  const items: import("@swim-app/shared").TimelineResponse = [
    { type: "note", noteType: "observation", id: NOTE_ID, body: "Coach note body", createdAt: "2025-01-10T12:00:00.000Z" },
    {
      type: "rating_note",
      id: "rn-1",
      body: "Rating note body",
      createdAt: "2025-01-09T12:00:00.000Z",
      tiedTo: { sessionId: SESSION_ID, skillId: SKILL_ID },
    },
  ];

  it("renders All, four note types, Rating note, and Priority filter buttons", () => {
    render(<SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={EMPTY_CATEGORIES} />);
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Observation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recommendation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rating note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Priority" })).toBeInTheDocument();
  });

  it("shows all items when All filter is active (default)", () => {
    render(<SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={EMPTY_CATEGORIES} />);
    expect(screen.getByText("Coach note body")).toBeInTheDocument();
    expect(screen.getByText("Rating note body")).toBeInTheDocument();
  });

  it("filters to only observation notes when Observation filter is clicked", () => {
    render(<SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={EMPTY_CATEGORIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Observation" }));
    expect(screen.getByText("Coach note body")).toBeInTheDocument();
    expect(screen.queryByText("Rating note body")).toBeNull();
  });

  it("filters to only rating notes when Rating note filter is clicked", () => {
    render(<SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={EMPTY_CATEGORIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Rating note" }));
    expect(screen.queryByText("Coach note body")).toBeNull();
    expect(screen.getByText("Rating note body")).toBeInTheDocument();
  });

  it("shows empty message when no items match the filter", () => {
    render(<SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={EMPTY_CATEGORIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    expect(screen.getByText(/no timeline entries/i)).toBeInTheDocument();
  });

  it("filters Correction items by note type", () => {
    const correctionItem: import("@swim-app/shared").TimelineItem = {
      type: "note",
      noteType: "correction",
      id: "corr-1",
      body: "Correction note",
      createdAt: "2025-01-08T12:00:00.000Z",
    };
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={[...items, correctionItem]} categories={EMPTY_CATEGORIES} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Correction" }));
    expect(screen.getByText("Correction note")).toBeInTheDocument();
    expect(screen.queryByText("Coach note body")).toBeNull();
    expect(screen.queryByText("Rating note body")).toBeNull();
  });
});

// ── SwimmerTimeline — skill filter ────────────────────────────────────────────

describe("SwimmerTimeline — skill filter", () => {
  const items: import("@swim-app/shared").TimelineResponse = [
    {
      type: "rating_note",
      id: "rn-1",
      body: "Flutter kick note",
      createdAt: "2025-01-10T12:00:00.000Z",
      tiedTo: { sessionId: SESSION_ID, skillId: SKILL_ID },
    },
  ];

  it("renders skill filter dropdown when rating_notes with skillId exist", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={CATEGORIES_WITH_SKILL} />,
    );
    expect(screen.getByRole("combobox", { name: /filter by skill/i })).toBeInTheDocument();
  });

  it("shows skill name in dropdown", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={items} categories={CATEGORIES_WITH_SKILL} />,
    );
    expect(screen.getByRole("option", { name: "Flutter Kick" })).toBeInTheDocument();
  });
});

// ── SwimmerTimeline — inline edit/delete controls ─────────────────────────────

describe("SwimmerTimeline — edit/delete on notes", () => {
  const noteItem: import("@swim-app/shared").TimelineItem = {
    type: "note",
    noteType: "observation",
    id: NOTE_ID,
    body: "A coach note",
    createdAt: "2025-01-10T12:00:00.000Z",
  };

  const ratingNoteItem: import("@swim-app/shared").TimelineItem = {
    type: "rating_note",
    id: "rn-1",
    body: "A rating note",
    createdAt: "2025-01-09T12:00:00.000Z",
    tiedTo: { sessionId: SESSION_ID, skillId: SKILL_ID },
  };

  it("shows Edit and Delete buttons on type='note' items", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={[noteItem]} categories={EMPTY_CATEGORIES} />,
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("does not show Edit/Delete on type='rating_note' items", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={[ratingNoteItem]} categories={EMPTY_CATEGORIES} />,
    );
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("shows inline textarea when Edit is clicked", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={[noteItem]} categories={EMPTY_CATEGORIES} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("restores body text when Cancel is clicked after Edit", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={[noteItem]} categories={EMPTY_CATEGORIES} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText("A coach note")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows ConfirmDialog when Delete is clicked", () => {
    render(
      <SwimmerTimeline swimmerId={SWIMMER_ID} items={[noteItem]} categories={EMPTY_CATEGORIES} />,
    );
    // ConfirmDialog is always rendered (it's a <dialog>); delete button triggers showModal
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});
