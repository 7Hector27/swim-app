import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock SiteNav and SiteFooter (server components) to avoid import errors
vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
vi.mock("@/content/EvaluateContent/actions", () => ({
  submitEvaluation: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import GradeSelector from "../content/EvaluateContent/GradeSelector";
import SkillGradeRow from "../content/EvaluateContent/SkillGradeRow";
import StartGroupSection from "../content/EvaluateContent/StartGroupSection";
import UndoToast from "../content/EvaluateContent/UndoToast";
import { canSubmit, buildRatingsArray, defaultSkillDraft, initialSessionDraft } from "../content/EvaluateContent/helpers";
import type { SkillForRating } from "@swim-app/shared";

// ── Test data ─────────────────────────────────────────────────────────────────

const SKILL: SkillForRating = {
  id: "skill-1",
  slug: "free-kick",
  name: "Kick",
  type: "rubric",
  unit: null,
  ratedPerSide: false,
  parentSkillId: null,
  sortOrder: 1,
  faultTags: ["Bent knees", "Stiff ankles"],
};

const SIDED_SKILL: SkillForRating = {
  id: "skill-2",
  slug: "free-bilateral",
  name: "Bilateral breathing",
  type: "rubric",
  unit: null,
  ratedPerSide: true,
  parentSkillId: null,
  sortOrder: 2,
  faultTags: [],
};

const START_PARENT: SkillForRating = {
  id: "parent-1",
  slug: "track-start",
  name: "Track start",
  type: "composite",
  unit: null,
  ratedPerSide: false,
  parentSkillId: null,
  sortOrder: 10,
  faultTags: [],
};

function makeComponent(index: number): SkillForRating {
  return {
    id: `comp-${index}`,
    slug: `comp-slug-${index}`,
    name: `Component ${index}`,
    type: "rubric",
    unit: null,
    ratedPerSide: false,
    parentSkillId: "parent-1",
    sortOrder: index,
    faultTags: [],
  };
}
const COMPONENTS = [1, 2, 3, 4, 5, 6].map(makeComponent);

// ── Helper tests ──────────────────────────────────────────────────────────────

describe("canSubmit", () => {
  it("returns false when coachingPriority is empty", () => {
    const draft = { ...initialSessionDraft(), categoryId: "cat-1", sessionDate: "2026-10-14", context: "practice" as const };
    expect(canSubmit(draft, 1, false)).toBe(false);
  });

  it("returns false when no ratings", () => {
    const draft = { ...initialSessionDraft(), categoryId: "cat-1", sessionDate: "2026-10-14", context: "practice" as const, coachingPriority: "Fix kick" };
    expect(canSubmit(draft, 0, false)).toBe(false);
  });

  it("returns false when isPending", () => {
    const draft = { ...initialSessionDraft(), categoryId: "cat-1", sessionDate: "2026-10-14", context: "practice" as const, coachingPriority: "Fix kick" };
    expect(canSubmit(draft, 1, true)).toBe(false);
  });

  it("returns true when all fields present", () => {
    const draft = { ...initialSessionDraft(), categoryId: "cat-1", sessionDate: "2026-10-14", context: "practice" as const, coachingPriority: "Fix kick" };
    expect(canSubmit(draft, 1, false)).toBe(true);
  });
});

describe("buildRatingsArray", () => {
  it("excludes not-assessed skills (grade null + noConcept false)", () => {
    const draftSkills = { "skill-1": defaultSkillDraft() };
    expect(buildRatingsArray([SKILL], draftSkills)).toHaveLength(0);
  });

  it("includes graded skills", () => {
    const draftSkills = { "skill-1": { ...defaultSkillDraft(), grade: 3 as const } };
    const ratings = buildRatingsArray([SKILL], draftSkills);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.grade).toBe(3);
    expect(ratings[0]?.skillId).toBe("skill-1");
    expect(ratings[0]?.side).toBeNull();
  });

  it("side-rated skill produces two entries with correct sides", () => {
    const draftSkills = {
      "skill-2:left": { ...defaultSkillDraft(), grade: 3 as const },
      "skill-2:right": { ...defaultSkillDraft(), grade: 4 as const },
    };
    const ratings = buildRatingsArray([SIDED_SKILL], draftSkills);
    expect(ratings).toHaveLength(2);
    const left = ratings.find((r) => r.side === "left");
    const right = ratings.find((r) => r.side === "right");
    expect(left?.grade).toBe(3);
    expect(right?.grade).toBe(4);
    expect(left?.skillId).toBe("skill-2");
    expect(right?.skillId).toBe("skill-2");
  });

  it("includes noConcept skills with grade null", () => {
    const draftSkills = { "skill-1": { ...defaultSkillDraft(), noConcept: true } };
    const ratings = buildRatingsArray([SKILL], draftSkills);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.noConcept).toBe(true);
    expect(ratings[0]?.grade).toBeNull();
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

describe("GradeSelector", () => {
  it("renders N/A button", () => {
    const onChange = vi.fn();
    render(<GradeSelector value={null} disabled={false} onChange={onChange} labelPrefix="Kick" />);
    expect(screen.getByRole("radio", { name: /n\/a/i })).toBeInTheDocument();
  });

  it("N/A is selected by default when value is null", () => {
    const onChange = vi.fn();
    render(<GradeSelector value={null} disabled={false} onChange={onChange} labelPrefix="Kick" />);
    expect(screen.getByRole("radio", { name: /n\/a/i })).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the grade when a grade button is clicked", () => {
    const onChange = vi.fn();
    render(<GradeSelector value={null} disabled={false} onChange={onChange} labelPrefix="Kick" />);
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });
});

describe("SkillGradeRow — Not legal", () => {
  it("clicking Not legal after selecting grade 2 keeps grade and shows DQ badge", () => {
    const onChange = vi.fn();
    const draft = { ...defaultSkillDraft(), grade: 2 as const };
    render(<SkillGradeRow skill={SKILL} draftKey="skill-1" label="Kick" draft={draft} onChange={onChange} />);
    // Grade 2 is shown as selected
    const grade2Button = screen.getByRole("radio", { name: "2" });
    expect(grade2Button).toHaveAttribute("aria-checked", "true");
    // Click Not legal
    fireEvent.click(screen.getByRole("button", { name: /not legal/i }));
    // onChange called with notLegal: true
    expect(onChange).toHaveBeenCalledWith("skill-1", { notLegal: true });
  });

  it("shows DQ badge when draft.notLegal is true", () => {
    const onChange = vi.fn();
    const draft = { ...defaultSkillDraft(), grade: 2 as const, notLegal: true };
    render(<SkillGradeRow skill={SKILL} draftKey="skill-1" label="Kick" draft={draft} onChange={onChange} />);
    expect(screen.getByText("DQ")).toBeInTheDocument();
  });
});

describe("StartGroupSection", () => {
  it("shows In progress when no components are rated", () => {
    render(
      <StartGroupSection
        parent={START_PARENT}
        components={COMPONENTS}
        draftSkills={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("shows a grade when all 6 components are rated", () => {
    const draftSkills: Record<string, ReturnType<typeof defaultSkillDraft>> = {};
    for (const comp of COMPONENTS) {
      draftSkills[comp.id] = { ...defaultSkillDraft(), grade: 3 as const };
    }
    render(
      <StartGroupSection
        parent={START_PARENT}
        components={COMPONENTS}
        draftSkills={draftSkills}
        onChange={vi.fn()}
      />,
    );
    // The start grade pill is the only <span> with text "3"
    const pill = document.querySelector("span.rounded.border.font-bold");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe("3");
  });

  it("shows DQ when any component is not legal", () => {
    const draftSkills: Record<string, ReturnType<typeof defaultSkillDraft>> = {};
    for (const comp of COMPONENTS) {
      draftSkills[comp.id] = { ...defaultSkillDraft(), grade: 3 as const };
    }
    draftSkills["comp-1"] = { ...defaultSkillDraft(), grade: 2 as const, notLegal: true };
    render(
      <StartGroupSection
        parent={START_PARENT}
        components={COMPONENTS}
        draftSkills={draftSkills}
        onChange={vi.fn()}
      />,
    );
    // At least one DQ element must be present (pill and/or legend badge)
    expect(screen.getAllByText("DQ").length).toBeGreaterThanOrEqual(1);
  });
});

describe("UndoToast", () => {
  const SESSION_ID = "11111111-0000-0000-0000-000000000001";
  const SWIMMER = { id: "swimmer-1", firstName: "Alex" };

  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    // Mock window.location.href setter
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the undo button", () => {
    render(
      <UndoToast
        swimmer={SWIMMER}
        sessionId={SESSION_ID}
        accessToken="tok"
        savedAt={Date.now()}
      />,
    );
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("calls DELETE /coach/sessions/:id when undo is clicked", async () => {
    render(
      <UndoToast
        swimmer={SWIMMER}
        sessionId={SESSION_ID}
        accessToken="tok"
        savedAt={Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/coach/sessions/${SESSION_ID}`),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});
