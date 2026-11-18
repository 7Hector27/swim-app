import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock SiteNav (server component) to avoid import errors
vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/AddNoteForm", () => ({ default: () => null }));
vi.mock("@/content/EvaluateContent/actions", () => ({
  submitEvaluation: vi.fn(),
  saveDraft: vi.fn(),
  // deleteDraft returns a { ok: true } | { ok: false; status } result and
  // callers read `.ok`. A bare vi.fn() resolves to undefined and crashes the
  // Start-fresh handler with an unhandled rejection — the pre-push hook
  // treats that as a failure. Give it an ok default; tests that need the
  // failure branch override with mockResolvedValueOnce.
  deleteDraft: vi.fn().mockResolvedValue({ ok: true }),
  fetchDependencyMapAction: vi.fn().mockResolvedValue({ ok: false }),
  fetchServerDraftsAction: vi.fn().mockResolvedValue([]),
  deleteSessionAction: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import GradeSelector from "../content/EvaluateContent/GradeSelector";
import SkillGradeRow from "../content/EvaluateContent/SkillGradeRow";
import CalculatedSkillRow from "../content/EvaluateContent/CalculatedSkillRow";
import StartGroupSection from "../content/EvaluateContent/StartGroupSection";
import UndoToast from "../content/EvaluateContent/UndoToast";
import CollapsibleSection from "../content/EvaluateContent/CollapsibleSection";
import AutosaveStatus from "../content/EvaluateContent/AutosaveStatus";
import EvaluateContent from "../content/EvaluateContent/EvaluateContent";
import { buildRatingsArray, defaultSkillDraft } from "../content/EvaluateContent/helpers";
import { submitEvaluation } from "../content/EvaluateContent/actions";
import type { SkillForRating, ScreensResponse, CoachSwimmerDetail } from "@swim-app/shared";

// ── Test data ─────────────────────────────────────────────────────────────────

const SKILL: SkillForRating = {
  id: "skill-1",
  slug: "free-kick",
  name: "Kick",
  type: "rubric",
  unit: null,
  stroke: null,
  ratedPerSide: false,
  notLegalAllowed: true,
  parentSkillId: null,
  sortOrder: 1,
  faultTags: ["Bent knees", "Stiff ankles"],
  descriptors: [],
};

const SIDED_SKILL: SkillForRating = {
  id: "skill-2",
  slug: "free-bilateral",
  name: "Bilateral breathing",
  type: "rubric",
  unit: null,
  stroke: null,
  ratedPerSide: true,
  notLegalAllowed: false,
  parentSkillId: null,
  sortOrder: 2,
  faultTags: [],
  descriptors: [],
};

const START_PARENT: SkillForRating = {
  id: "parent-1",
  slug: "track-start",
  name: "Track start",
  type: "composite",
  unit: null,
  stroke: null,
  ratedPerSide: false,
  notLegalAllowed: false,
  parentSkillId: null,
  sortOrder: 10,
  faultTags: [],
  descriptors: [],
};

function makeComponent(index: number): SkillForRating {
  return {
    id: `comp-${index}`,
    slug: `comp-slug-${index}`,
    name: `Component ${index}`,
    type: "rubric",
    unit: null,
    stroke: null,
    ratedPerSide: false,
    notLegalAllowed: true,
    parentSkillId: "parent-1",
    sortOrder: index,
    faultTags: [],
    descriptors: [],
  };
}
const COMPONENTS = [1, 2, 3, 4, 5, 6].map(makeComponent);

// ── Helper tests ──────────────────────────────────────────────────────────────

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
  // Pass 2b: the N/A pill is gone — an untouched row has nothing selected.
  // Tapping the already-selected grade clears it to null. Arrow keys move
  // between the five grade pills; a polite live region announces the
  // cleared state.

  it("renders only the 1-5 grade buttons (no N/A pill)", () => {
    render(<GradeSelector value={null} disabled={false} onChange={vi.fn()} labelPrefix="Kick" />);
    for (const grade of ["1", "2", "3", "4", "5"]) {
      expect(screen.getByRole("radio", { name: grade })).toBeInTheDocument();
    }
    expect(screen.queryByRole("radio", { name: /n\/a/i })).toBeNull();
  });

  it("nothing is selected when value is null (untouched row)", () => {
    render(<GradeSelector value={null} disabled={false} onChange={vi.fn()} labelPrefix="Kick" />);
    for (const grade of ["1", "2", "3", "4", "5"]) {
      expect(screen.getByRole("radio", { name: grade })).toHaveAttribute("aria-checked", "false");
    }
  });

  it("calls onChange with the grade when a grade pill is tapped", () => {
    const onChange = vi.fn();
    render(<GradeSelector value={null} disabled={false} onChange={onChange} labelPrefix="Kick" />);
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("calls onChange(null) when the already-selected grade is tapped (toggle to cleared)", () => {
    const onChange = vi.fn();
    render(<GradeSelector value={4} disabled={false} onChange={onChange} labelPrefix="Kick" />);
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("announces the cleared state via a polite live region", () => {
    const { rerender } = render(
      <GradeSelector value={3} disabled={false} onChange={vi.fn()} labelPrefix="Freestyle kick" />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/grade 3/i);
    rerender(<GradeSelector value={null} disabled={false} onChange={vi.fn()} labelPrefix="Freestyle kick" />);
    expect(screen.getByRole("status").textContent).toMatch(/no grade selected/i);
  });

  it("arrow keys cycle onChange through adjacent grades", () => {
    const onChange = vi.fn();
    render(<GradeSelector value={3} disabled={false} onChange={onChange} labelPrefix="Kick" />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "3" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(screen.getByRole("radio", { name: "3" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});

describe("SkillGradeRow — Not legal", () => {
  it("clicking Not legal after selecting grade 2 keeps grade and shows DQ badge", () => {
    const onChange = vi.fn();
    const draft = { ...defaultSkillDraft(), grade: 2 as const };
    render(<SkillGradeRow skill={SKILL} draftKey="skill-1" label="Kick" draft={draft} onChange={onChange} />);
    const grade2Button = screen.getByRole("radio", { name: "2" });
    expect(grade2Button).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /not legal/i }));
    expect(onChange).toHaveBeenCalledWith("skill-1", { notLegal: true });
  });

  it("shows the Not legal badge when draft.notLegal is true", () => {
    const onChange = vi.fn();
    const draft = { ...defaultSkillDraft(), grade: 2 as const, notLegal: true };
    render(<SkillGradeRow skill={SKILL} draftKey="skill-1" label="Kick" draft={draft} onChange={onChange} />);
    // Both the "Not legal" toggle button AND the DQ-replacement badge render
    // this text; the test asserts the badge is present by requiring at least
    // two matches (button + badge).
    expect(screen.getAllByText("Not legal").length).toBeGreaterThanOrEqual(2);
  });
});

describe("SkillGradeRow — notLegalAllowed gating", () => {
  it("hides Not legal button when notLegalAllowed is false", () => {
    const skill: SkillForRating = { ...SKILL, notLegalAllowed: false };
    render(<SkillGradeRow skill={skill} draftKey="s" label="Kick" draft={{ ...defaultSkillDraft(), grade: 3 as const }} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /not legal/i })).toBeNull();
  });

  it("shows Not legal button when notLegalAllowed is true", () => {
    render(<SkillGradeRow skill={SKILL} draftKey="s" label="Kick" draft={{ ...defaultSkillDraft(), grade: 3 as const }} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /not legal/i })).toBeInTheDocument();
  });
});

describe("SkillGradeRow — previous rating badge", () => {
  it("renders the swimmer's prior numeric grade next to the skill name", () => {
    render(
      <SkillGradeRow
        skill={SKILL}
        draftKey="skill-1"
        label="Kick"
        draft={defaultSkillDraft()}
        onChange={vi.fn()}
        prevGrade={3}
      />,
    );
    const badge = screen.getByLabelText(/previous rating: 3/i);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/last/i);
    expect(badge.textContent).toMatch(/3/);
  });

  it("renders a Not legal badge when the prior rating was not_legal", () => {
    render(
      <SkillGradeRow
        skill={SKILL}
        draftKey="skill-1"
        label="Kick"
        draft={defaultSkillDraft()}
        onChange={vi.fn()}
        prevGrade={"not_legal"}
      />,
    );
    expect(screen.getByLabelText(/previous rating: not legal/i)).toBeInTheDocument();
  });

  it("renders a New badge when there's no prior rating", () => {
    render(
      <SkillGradeRow
        skill={SKILL}
        draftKey="skill-1"
        label="Kick"
        draft={defaultSkillDraft()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/no previous rating/i)).toBeInTheDocument();
  });
});

describe("SkillGradeRow — measurement on row (Pass 2b)", () => {
  // The number box moved from DetailsPanel onto the row. The details panel
  // now only holds fault tags, capacity, and the free-text note.
  const MEASURED_SKILL: SkillForRating = {
    ...SKILL,
    id: "measured-skill",
    slug: "free-tempo",
    name: "Tempo",
    type: "measured",
    unit: "cycles/min",
    notLegalAllowed: false,
  };

  it("shows the measurement number input on the row with the unit label", () => {
    render(
      <SkillGradeRow
        skill={MEASURED_SKILL}
        draftKey={MEASURED_SKILL.id}
        label="Tempo"
        draft={defaultSkillDraft()}
        onChange={vi.fn()}
      />,
    );
    // Row-level input exists and is visible without expanding anything.
    expect(screen.getByRole("spinbutton", { name: /Measurement/i })).toBeInTheDocument();
    expect(screen.getByText("cycles/min")).toBeInTheDocument();
    // No "Hide details" / "Add details" expansion needed to see it.
    expect(screen.queryByRole("button", { name: /Hide details/i })).toBeNull();
  });

  it("writes the typed value to measurementValue through onChange", () => {
    const onChange = vi.fn();
    render(
      <SkillGradeRow
        skill={MEASURED_SKILL}
        draftKey={MEASURED_SKILL.id}
        label="Tempo"
        draft={defaultSkillDraft()}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /Measurement/i }), { target: { value: "62" } });
    expect(onChange).toHaveBeenCalledWith(MEASURED_SKILL.id, { measurementValue: "62" });
  });

  it("details panel no longer renders the measurement input (it lives on the row)", () => {
    const onChange = vi.fn();
    render(
      <SkillGradeRow
        skill={MEASURED_SKILL}
        draftKey={MEASURED_SKILL.id}
        label="Tempo"
        draft={{ ...defaultSkillDraft(), detailsOpen: true }}
        onChange={onChange}
      />,
    );
    // Exactly one measurement spinbutton on the whole row (the one on the
    // header level), and the details panel shows capacity + note instead.
    expect(screen.getAllByRole("spinbutton", { name: /Measurement/i })).toHaveLength(1);
    expect(screen.getByLabelText(/Capacity/i)).toBeInTheDocument();
  });

  // Pass 2c: golf score + kick rate stop using the fallback note.
  // Golf score renders the two-input mode (see "SkillGradeRow — Pass 2c
  // golf + kick rate" below). Kick rate becomes a normal single-input
  // measured row once "kicks/min" maps to kicks_per_minute.
});

describe("SkillGradeRow — Pass 2c golf + kick rate", () => {
  // Pass 2c: golf-score skills render two number inputs (Time + Stroke
  // count) and a derived golf score. Kick rate (previously blocked by
  // the unmapped-unit fallback) now renders as a normal single-input
  // measured row because "kicks/min" maps to kicks_per_minute.

  it("golf skill shows Time and Stroke count inputs and the derived score", () => {
    const golf: SkillForRating = {
      ...SKILL,
      id: "golf-score",
      slug: "free-golf-score",
      name: "Golf score",
      type: "score",
      unit: "time_s + stroke_count",
      notLegalAllowed: false,
    };
    const onChange = vi.fn();
    render(
      <SkillGradeRow
        skill={golf}
        draftKey={golf.id}
        label="Golf score"
        draft={{ ...defaultSkillDraft(), timeSeconds: "14.25", strokeCountValue: "18" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText(/Time/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stroke count/i)).toBeInTheDocument();
    // Category pills still on the row for golf.
    expect(screen.getByRole("button", { name: /Push-off in water/i })).toBeInTheDocument();
    // Derived score = 14.25 + 18 = 32.25 → "32.3" rounded to 1 decimal.
    // The number only appears in the derived readout paragraph, so matching
    // by the numeric text is safe (the label "Golf score" has no colon).
    expect(screen.getByText(/32\.3/)).toBeInTheDocument();
  });

  it("golf skill writes timeSeconds / strokeCountValue through onChange", () => {
    const golf: SkillForRating = {
      ...SKILL,
      id: "golf-score",
      slug: "free-golf-score",
      name: "Golf score",
      type: "score",
      unit: "time_s + stroke_count",
      notLegalAllowed: false,
    };
    const onChange = vi.fn();
    render(
      <SkillGradeRow
        skill={golf}
        draftKey={golf.id}
        label="Golf score"
        draft={defaultSkillDraft()}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Time/i), { target: { value: "14.25" } });
    expect(onChange).toHaveBeenCalledWith(golf.id, { timeSeconds: "14.25" });
    fireEvent.change(screen.getByLabelText(/Stroke count/i), { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith(golf.id, { strokeCountValue: "18" });
  });

  it("kick-rate skill now renders a single-number row (was the 'can't be saved yet' fallback)", () => {
    const kickRate: SkillForRating = {
      ...SKILL,
      id: "kick-rate",
      slug: "free-kick-rate",
      name: "Kick rate",
      type: "measured",
      unit: "kicks/min",
      notLegalAllowed: false,
    };
    render(
      <SkillGradeRow
        skill={kickRate}
        draftKey={kickRate.id}
        label="Kick rate"
        draft={defaultSkillDraft()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: /Measurement/i })).toBeInTheDocument();
    expect(screen.getByText("kicks/min")).toBeInTheDocument();
    expect(screen.queryByText(/can't be saved yet/i)).toBeNull();
  });

  it("buildRatingsArray emits timeSeconds + strokeCountValue for score skills", () => {
    const golf: SkillForRating = {
      ...SKILL,
      id: "golf-score",
      slug: "free-golf-score",
      name: "Golf score",
      type: "score",
      unit: "time_s + stroke_count",
      notLegalAllowed: false,
    };
    const ratings = buildRatingsArray([golf], {
      [golf.id]: {
        ...defaultSkillDraft(),
        grade: 3,
        timeSeconds: "14.25",
        strokeCountValue: "18",
        golfScoreCategory: "push_off_in_water",
      },
    });
    expect(ratings).toHaveLength(1);
    expect(ratings[0]!.timeSeconds).toBe(14.25);
    expect(ratings[0]!.strokeCountValue).toBe(18);
    expect(ratings[0]!.golfScoreCategory).toBe("push_off_in_water");
  });

  it("buildRatingsArray passes through a partial pair so validateSubmission can flag it", () => {
    // Pass 2c follow-up: silent scrub replaced by surfacing the partial
    // state to Zod. validateSubmission emits a timeSeconds issue; the row
    // renders "Enter both time and stroke count" and save is blocked.
    const golf: SkillForRating = {
      ...SKILL,
      id: "golf-score",
      slug: "free-golf-score",
      name: "Golf score",
      type: "score",
      unit: "time_s + stroke_count",
      notLegalAllowed: false,
    };
    const ratings = buildRatingsArray([golf], {
      [golf.id]: {
        ...defaultSkillDraft(),
        grade: 3,
        timeSeconds: "14.25",
        strokeCountValue: "",
        golfScoreCategory: "push_off_in_water",
      },
    });
    expect(ratings[0]!.timeSeconds).toBe(14.25);
    expect(ratings[0]!.strokeCountValue).toBeNull();
  });

  // Pass 2c follow-up: row-level rendering of the two validation errors.

  it("renders the 'Enter both time and stroke count' message under the two inputs when passed a timeSeconds issue", () => {
    const golf: SkillForRating = {
      ...SKILL,
      id: "golf-score",
      slug: "free-golf-score",
      name: "Golf score",
      type: "score",
      unit: "time_s + stroke_count",
      notLegalAllowed: false,
    };
    render(
      <SkillGradeRow
        skill={golf}
        draftKey={golf.id}
        label="Golf score"
        draft={{ ...defaultSkillDraft(), grade: 3, timeSeconds: "14.25", strokeCountValue: "" }}
        onChange={vi.fn()}
        issues={[{ ratingIndex: 0, field: "timeSeconds", message: "Enter both time and stroke count." }]}
      />,
    );
    expect(screen.getByText(/Enter both time and stroke count/i)).toBeInTheDocument();
    // The stroke-count input (the empty one) gets aria-invalid; the
    // filled time input does not, so the coach's eye lands on the right box.
    const strokesInput = screen.getByLabelText(/Stroke count/i);
    expect(strokesInput).toHaveAttribute("aria-invalid", "true");
    const timeInput = screen.getByLabelText(/Time/i);
    expect(timeInput).not.toHaveAttribute("aria-invalid");
  });

  it("renders the 'Pick a test category' message near the category pills when passed a golfScoreCategory issue", () => {
    const golf: SkillForRating = {
      ...SKILL,
      id: "golf-score",
      slug: "free-golf-score",
      name: "Golf score",
      type: "score",
      unit: "time_s + stroke_count",
      notLegalAllowed: false,
    };
    render(
      <SkillGradeRow
        skill={golf}
        draftKey={golf.id}
        label="Golf score"
        draft={{
          ...defaultSkillDraft(),
          grade: 3,
          timeSeconds: "14.25",
          strokeCountValue: "18",
          golfScoreCategory: null,
        }}
        onChange={vi.fn()}
        issues={[
          {
            ratingIndex: 0,
            field: "golfScoreCategory",
            message: "Pick a test category before saving a golf score.",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Pick a test category/i)).toBeInTheDocument();
    // Category pill group has aria-invalid set.
    const categoryGroup = screen.getByRole("group", { name: "" });
    expect(categoryGroup).toHaveAttribute("aria-invalid", "true");
  });
});

describe("CalculatedSkillRow", () => {
  const rollupSkill: SkillForRating = {
    id: "rollup-1",
    slug: "free-bilateral-breathing",
    name: "Bilateral Breathing",
    type: "rollup",
    unit: null,
    stroke: null,
    ratedPerSide: false,
    notLegalAllowed: false,
    parentSkillId: null,
    sortOrder: 5,
    faultTags: [],
    descriptors: [],
  };

  it("renders the skill label", () => {
    render(<CalculatedSkillRow skill={rollupSkill} label="Bilateral Breathing" />);
    expect(screen.getByText("Bilateral Breathing")).toBeInTheDocument();
  });

  it("shows Calculated automatically text", () => {
    render(<CalculatedSkillRow skill={rollupSkill} label="Bilateral Breathing" />);
    expect(screen.getByText(/calculated automatically/i)).toBeInTheDocument();
  });

  it("renders no grade selector or interactive buttons", () => {
    render(<CalculatedSkillRow skill={rollupSkill} label="Bilateral Breathing" />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("buildRatingsArray — rollup exclusion", () => {
  it("excludes rollup skills from the ratings array", () => {
    const rollupSkill: SkillForRating = { ...SKILL, id: "rollup-1", type: "rollup" };
    const draftSkills = { "rollup-1": { ...defaultSkillDraft(), grade: 3 as const } };
    expect(buildRatingsArray([rollupSkill], draftSkills)).toHaveLength(0);
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
    const pill = screen.getByTestId("start-grade-pill");
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toBe("3");
  });

  it("shows Not legal when any component is not legal", () => {
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
    expect(screen.getAllByText("Not legal").length).toBeGreaterThanOrEqual(1);
  });
});

// ── Draft persistence — full component ────────────────────────────────────────

const SWIMMER_ID = "00000000-0000-0000-aaaa-000000000001";
const OTHER_SWIMMER_ID = "00000000-0000-0000-aaaa-000000000002";
const SCREEN_A_SLUG = "freestyle";
const SCREEN_B_SLUG = "backstroke";
const SKILL_A_ID = "00000000-0000-0000-cccc-000000000001";
const SKILL_B_ID = "00000000-0000-0000-cccc-000000000002";

const SWIMMER_DETAIL: CoachSwimmerDetail = {
  id: SWIMMER_ID,
  firstName: "Alex",
  lastName: "Smith",
  age: 10,
  sex: "female",
  isPublic: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
  memberNames: [],
  lastLesson: null,
  birthDate: "2015-01-01",
  householdId: "00000000-0000-0000-0000-000000000ff0",
  members: [],
  homePool: null,
};

const TEST_SCREENS: ScreensResponse = [
  {
    screenSlug: SCREEN_A_SLUG,
    name: "Freestyle",
    skills: [{
      id: SKILL_A_ID, slug: "free-kick", name: "Freestyle Kick",
      type: "rubric", unit: null, stroke: null, ratedPerSide: false, notLegalAllowed: false,
      parentSkillId: null, sortOrder: 1, faultTags: [], descriptors: [],
    }],
  },
  {
    screenSlug: SCREEN_B_SLUG,
    name: "Backstroke",
    skills: [{
      id: SKILL_B_ID, slug: "back-kick", name: "Backstroke Kick",
      type: "rubric", unit: null, stroke: null, ratedPerSide: false, notLegalAllowed: false,
      parentSkillId: null, sortOrder: 1, faultTags: [], descriptors: [],
    }],
  },
];

const metaKey = (swimId: string) => `evaluate-draft-meta-${swimId}`;
const skillsKey = (swimId: string, slug: string) => `evaluate-draft-skills-${swimId}-${slug}`;

describe("draft persistence — full component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(submitEvaluation).mockResolvedValue({ status: "idle" });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestion: null }) });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("restores coaching priority and screen from a saved draft on mount", async () => {
    localStorage.setItem(metaKey(SWIMMER_ID), JSON.stringify({
      screenSlug: SCREEN_A_SLUG,
      sessionDate: "2026-10-14",
      context: "practice",
      coachingPriority: "Fix the kick technique",
      breathingPattern: null,
    }));
    localStorage.setItem(skillsKey(SWIMMER_ID, SCREEN_A_SLUG), JSON.stringify({ skills: {} }));

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/main focus/i),
      ).toHaveValue("Fix the kick technique");
    });
  });

  it("does not restore a different swimmer's draft", async () => {
    localStorage.setItem(metaKey(OTHER_SWIMMER_ID), JSON.stringify({
      screenSlug: SCREEN_A_SLUG,
      sessionDate: "2026-10-14",
      context: "practice",
      coachingPriority: "Wrong swimmer priority",
      breathingPattern: null,
    }));

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    await act(async () => {});

    expect(screen.getByPlaceholderText(/main focus/i)).toHaveValue("");
  });

  it("loads the correct skill draft per screen and does not bleed across screens", async () => {
    localStorage.setItem(skillsKey(SWIMMER_ID, SCREEN_A_SLUG), JSON.stringify({
      skills: { [SKILL_A_ID]: { ...defaultSkillDraft(), grade: 3 } },
    }));
    localStorage.setItem(skillsKey(SWIMMER_ID, SCREEN_B_SLUG), JSON.stringify({
      skills: { [SKILL_B_ID]: { ...defaultSkillDraft(), grade: 5 } },
    }));

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    const select = screen.getByRole("combobox");

    fireEvent.change(select, { target: { value: SCREEN_A_SLUG } });
    await waitFor(() => {
      const grade3 = screen.getAllByRole("radio", { name: "3" });
      expect(grade3.some((btn) => btn.getAttribute("aria-checked") === "true")).toBe(true);
    });

    fireEvent.change(select, { target: { value: SCREEN_B_SLUG } });
    await waitFor(() => {
      const grade5 = screen.getAllByRole("radio", { name: "5" });
      expect(grade5.some((btn) => btn.getAttribute("aria-checked") === "true")).toBe(true);
      const grade3 = screen.getAllByRole("radio", { name: "3" });
      expect(grade3.every((btn) => btn.getAttribute("aria-checked") === "false")).toBe(true);
    });
  });

  it("clears both localStorage keys after a successful save", async () => {
    // Freestyle requires breathingPattern. Supply it so the pre-save
    // client validator doesn't block the submit.
    localStorage.setItem(metaKey(SWIMMER_ID), JSON.stringify({
      screenSlug: SCREEN_A_SLUG,
      sessionDate: "2026-10-14",
      context: "practice",
      coachingPriority: "Fix kick",
      breathingPattern: "every_3",
    }));
    localStorage.setItem(skillsKey(SWIMMER_ID, SCREEN_A_SLUG), JSON.stringify({
      skills: { [SKILL_A_ID]: { ...defaultSkillDraft(), grade: 3 } },
    }));
    vi.mocked(submitEvaluation).mockResolvedValue({
      status: "saved",
      sessionId: "00000000-0000-0000-0000-000000000099",
      ratingIds: [],
    });

    const { container } = render(
      <EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/main focus/i)).toHaveValue("Fix kick");
    });

    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });

    await waitFor(() => {
      expect(screen.getByText(/evaluation saved/i)).toBeInTheDocument();
    });

    expect(localStorage.getItem(metaKey(SWIMMER_ID))).toBeNull();
    expect(localStorage.getItem(skillsKey(SWIMMER_ID, SCREEN_A_SLUG))).toBeNull();
  });
});

// ── Section header rendering ──────────────────────────────────────────────────

describe("EvaluateContent — section headers for screen-sectioned screens", () => {
  const FREESTYLE_SKILL_ID = "00000000-0000-0000-ffff-000000000001";

  const freestyleScreens: ScreensResponse = [
    {
      screenSlug: "freestyle",
      name: "Freestyle",
      skills: [
        {
          id: FREESTYLE_SKILL_ID,
          slug: "free-head-position",
          name: "Head Position",
          type: "rubric",
          unit: null,
          stroke: "free" as const,
          ratedPerSide: false,
          notLegalAllowed: false,
          parentSkillId: null,
          sortOrder: 1,
          faultTags: [],
          descriptors: [],
        },
      ],
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(submitEvaluation).mockResolvedValue({ status: "idle" });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestion: null }) });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders The swim section header when freestyle screen is selected", async () => {
    render(
      <EvaluateContent
        swimmer={SWIMMER_DETAIL}
        screens={freestyleScreens}
        prevGrades={{}}
      />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "freestyle" } });

    await waitFor(() => {
      expect(screen.getByText("The swim")).toBeInTheDocument();
    });
  });
});

// ── Breathing pattern selector ────────────────────────────────────────────────

describe("EvaluateContent — breathing pattern selector", () => {
  const freestyleScreens: ScreensResponse = [
    {
      screenSlug: "freestyle",
      name: "Freestyle",
      skills: [{
        id: "skill-fp-1", slug: "free-kick", name: "Kick",
        type: "rubric", unit: null, stroke: "free" as const, ratedPerSide: false,
        notLegalAllowed: false, parentSkillId: null, sortOrder: 1, faultTags: [], descriptors: [],
      }],
    },
    {
      screenSlug: "backstroke",
      name: "Backstroke",
      skills: [{
        id: "skill-bp-1", slug: "back-kick", name: "Kick",
        type: "rubric", unit: null, stroke: "back" as const, ratedPerSide: false,
        notLegalAllowed: false, parentSkillId: null, sortOrder: 1, faultTags: [], descriptors: [],
      }],
    },
    {
      screenSlug: "butterfly",
      name: "Butterfly",
      skills: [{
        // fly-dolphin-kick lives in butterfly's "The swim" section — Pass 2a
        // renders the breathing-pattern picker at the end of that section on
        // freestyle/butterfly, so the fixture needs at least one slug that
        // places the swim section in the rendered output.
        id: "skill-fp-2", slug: "fly-dolphin-kick", name: "Dolphin kick",
        type: "rubric", unit: null, stroke: "fly" as const, ratedPerSide: false,
        notLegalAllowed: false, parentSkillId: null, sortOrder: 1, faultTags: [], descriptors: [],
      }],
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(submitEvaluation).mockResolvedValue({ status: "idle" });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestion: null }) });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows breathing pattern selector for freestyle screen", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={freestyleScreens} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "freestyle" } });
    await waitFor(() => {
      expect(screen.getByText("Breathing pattern")).toBeInTheDocument();
    });
  });

  it("shows breathing pattern selector for butterfly screen", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={freestyleScreens} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "butterfly" } });
    await waitFor(() => {
      expect(screen.getByText("Breathing pattern")).toBeInTheDocument();
    });
  });

  it("does not show breathing pattern selector for backstroke screen", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={freestyleScreens} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "backstroke" } });
    await waitFor(() => {
      expect(screen.queryByText("Breathing pattern")).toBeNull();
    });
  });
});

describe("UndoToast", () => {
  const SESSION_ID = "11111111-0000-0000-0000-000000000001";
  const SWIMMER = { id: "swimmer-1", firstName: "Alex" };

  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
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
        savedAt={Date.now()}
      />,
    );
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("calls deleteSessionAction when undo is clicked", async () => {
    const { deleteSessionAction } = await import("../content/EvaluateContent/actions");
    render(
      <UndoToast
        swimmer={SWIMMER}
        sessionId={SESSION_ID}
        savedAt={Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await vi.waitFor(() => {
      expect(deleteSessionAction).toHaveBeenCalledWith(SESSION_ID);
    });
  });
});

// ── CollapsibleSection ────────────────────────────────────────────────────────

describe("CollapsibleSection", () => {
  it("renders the section name and the completed/count badge", () => {
    render(
      <CollapsibleSection
        name="The swim"
        count={10}
        completed={3}
        open={true}
        onToggle={() => {}}
        anchorId="section-swim"
      >
        <div>body</div>
      </CollapsibleSection>,
    );
    expect(screen.getByText("The swim")).toBeInTheDocument();
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("exposes aria-expanded + an anchorable section wrapper", () => {
    const { rerender } = render(
      <CollapsibleSection
        name="Underwaters"
        count={2}
        completed={0}
        open={false}
        onToggle={() => {}}
        anchorId="section-underwaters"
      >
        <div>body</div>
      </CollapsibleSection>,
    );
    const toggle = screen.getByRole("button", { name: /Underwaters/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("section-underwaters")).not.toBeNull();
    // Body is hidden when the section is closed.
    expect(screen.queryByText("body")).toBeNull();

    rerender(
      <CollapsibleSection
        name="Underwaters"
        count={2}
        completed={0}
        open={true}
        onToggle={() => {}}
        anchorId="section-underwaters"
      >
        <div>body</div>
      </CollapsibleSection>,
    );
    expect(screen.getByRole("button", { name: /Underwaters/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("calls onToggle when the header is clicked", () => {
    const toggle = vi.fn();
    render(
      <CollapsibleSection
        name="Breakout"
        count={1}
        completed={0}
        open={false}
        onToggle={toggle}
        anchorId="section-breakout"
      >
        <div>body</div>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Breakout/ }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

// ── Pre-save client validation ────────────────────────────────────────────────

describe("AutosaveStatus", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<AutosaveStatus state="idle" lastSavedAt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Saving...' while the draft is in flight", () => {
    render(<AutosaveStatus state="saving" lastSavedAt={null} />);
    expect(screen.getByTestId("autosave-status").textContent).toBe("Saving...");
  });

  it("shows 'Saved' with the local time after a successful save", () => {
    // Fixed instant — 10:23 America/Los_Angeles.
    const ts = new Date("2026-11-18T18:23:00Z").getTime();
    render(<AutosaveStatus state="saved" lastSavedAt={ts} />);
    expect(screen.getByTestId("autosave-status").textContent).toMatch(/^Saved/);
    expect(screen.getByTestId("autosave-status").textContent).toMatch(/10:23/);
  });

  it("surfaces an error with role=alert when the save fails", () => {
    render(<AutosaveStatus state="error" lastSavedAt={null} />);
    const status = screen.getByTestId("autosave-status");
    expect(status.textContent).toBe("Couldn't save. Try again.");
    expect(status).toHaveAttribute("role", "alert");
  });
});

describe("EvaluateContent — pre-save validation", () => {
  const VALIDATION_SCREENS: ScreensResponse = [
    {
      screenSlug: "freestyle",
      name: "Freestyle",
      skills: [{
        id: SKILL_A_ID, slug: "free-kick", name: "Freestyle Kick",
        type: "rubric", unit: null, stroke: "free" as const, ratedPerSide: false,
        notLegalAllowed: false, parentSkillId: null, sortOrder: 1, faultTags: [], descriptors: [],
      }],
    },
  ];

  const scrollIntoViewMock = vi.fn();
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    localStorage.clear();
    scrollIntoViewMock.mockClear();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    vi.mocked(submitEvaluation).mockResolvedValue({ status: "idle" });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestion: null }) });
  });

  afterEach(() => {
    localStorage.clear();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.clearAllMocks();
  });

  // Takes the form from "nothing filled" to "almost there" so the only
  // remaining required field is breathingPattern. Returns the form element.
  // Coaching priority is left blank on purpose: starting with migration 0061
  // it's optional, so the form should still submit without it.
  async function setupAlmostCompleteForm(container: HTMLElement): Promise<HTMLFormElement> {
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "freestyle" } });

    // Freestyle shows the breathing pattern picker but we deliberately skip it.
    await waitFor(() => {
      expect(screen.getByText("Breathing pattern")).toBeInTheDocument();
    });

    // Pick a context.
    fireEvent.click(screen.getByRole("button", { name: /practice/i }));

    // Rate the one skill so ratings[] is non-empty.
    await waitFor(() => {
      expect(screen.getAllByRole("radio", { name: "3" }).length).toBeGreaterThan(0);
    });
    const grade3 = screen.getAllByRole("radio", { name: "3" })[0]!;
    fireEvent.click(grade3);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    return form!;
  }

  it("blocks the submit, surfaces per-field + summary alerts, and scrolls to the first missing field", async () => {
    const { container } = render(
      <EvaluateContent swimmer={SWIMMER_DETAIL} screens={VALIDATION_SCREENS} prevGrades={{}} />,
    );
    const form = await setupAlmostCompleteForm(container);

    // breathingPattern stays unpicked. Tap Save.
    await act(async () => {
      fireEvent.submit(form);
    });

    // The server action was never dispatched.
    expect(vi.mocked(submitEvaluation)).not.toHaveBeenCalled();

    // Summary alert surfaces with the pluralized copy.
    const summary = screen.getByTestId("evaluate-issues-summary");
    expect(summary.textContent).toMatch(/1 thing needs attention/i);

    // Per-field error renders next to the Breathing pattern group.
    const breathingGroup = container.querySelector("[id='evaluate-field-breathingPattern'] [role='group']");
    expect(breathingGroup).not.toBeNull();
    expect(breathingGroup).toHaveAttribute("aria-invalid", "true");

    // scrollIntoView fires on the breathingPattern fieldset.
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  // Regression: coaching priority is optional starting with migration 0061.
  // A fully-rated form with an empty priority should submit successfully.
  it("allows saving when coaching priority is left blank", async () => {
    vi.mocked(submitEvaluation).mockResolvedValue({
      status: "saved",
      sessionId: "00000000-0000-0000-0000-000000000099",
      ratingIds: [],
    });

    const { container } = render(
      <EvaluateContent swimmer={SWIMMER_DETAIL} screens={VALIDATION_SCREENS} prevGrades={{}} />,
    );
    const form = await setupAlmostCompleteForm(container);

    // Pick a breathing pattern so the form is fully valid except for the
    // intentionally-empty coachingPriority textarea.
    fireEvent.click(screen.getByRole("button", { name: "Every 3" }));

    await act(async () => {
      fireEvent.submit(form);
    });

    // Save succeeds — no issues banner surfaces, and the saved screen renders.
    expect(screen.queryByTestId("evaluate-issues-summary")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/evaluation saved/i)).toBeInTheDocument();
    });
  });

  it("re-scrolls on every tap, not just the first", async () => {
    const { container } = render(
      <EvaluateContent swimmer={SWIMMER_DETAIL} screens={VALIDATION_SCREENS} prevGrades={{}} />,
    );
    const form = await setupAlmostCompleteForm(container);

    await act(async () => {
      fireEvent.submit(form);
    });
    await act(async () => {
      fireEvent.submit(form);
    });
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(3);
    expect(vi.mocked(submitEvaluation)).not.toHaveBeenCalled();
  });

  it("honors prefers-reduced-motion when scrolling", async () => {
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(() => true),
    }));

    const { container } = render(
      <EvaluateContent swimmer={SWIMMER_DETAIL} screens={VALIDATION_SCREENS} prevGrades={{}} />,
    );
    const form = await setupAlmostCompleteForm(container);

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
    matchMediaSpy.mockRestore();
  });
});

describe("EvaluateContent — server draft banner", () => {
  const DRAFT_ID = "draft-0000-0000-0000-000000000001";
  const DRAFT_SCREEN = "freestyle";
  const DRAFT_DATE = "2026-10-14T10:00:00.000Z";

  const serverDraft: import("@swim-app/shared").EvaluationDraft = {
    id: DRAFT_ID,
    swimmerId: SWIMMER_ID,
    screenSlug: DRAFT_SCREEN,
    sessionDate: "2026-10-14",
    context: "practice",
    coachingPriority: "Kick",
    breathingPattern: "every_3",
    payload: {},
    createdAt: DRAFT_DATE,
    updatedAt: DRAFT_DATE,
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.mocked(submitEvaluation).mockResolvedValue({ status: "idle" });
    const { fetchServerDraftsAction } = await import("../content/EvaluateContent/actions");
    vi.mocked(fetchServerDraftsAction).mockResolvedValue([serverDraft]);
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows the resume banner when a server draft exists for the selected screen", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DRAFT_SCREEN } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/resume it\?/i)).toBeInTheDocument();
    });
  });

  it("does not show the banner when no server draft exists for the selected screen", async () => {
    const { fetchServerDraftsAction } = await import("../content/EvaluateContent/actions");
    vi.mocked(fetchServerDraftsAction).mockResolvedValue([]);

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DRAFT_SCREEN } });

    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clicking Start fresh shows a confirm prompt", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DRAFT_SCREEN } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /start fresh/i }));

    await waitFor(() => {
      expect(screen.getByText(/delete this draft/i)).toBeInTheDocument();
    });
  });

  it("clicking Delete draft calls DELETE on the draft and dismisses the banner", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DRAFT_SCREEN } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    await waitFor(() => {
      expect(screen.getByText(/delete this draft/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /delete draft/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("shows an error alert when the deleteDraft call fails after 'Start fresh' is confirmed", async () => {
    // deleteDraft now returns a result; a failure must surface an alert so
    // the user doesn't believe the draft was discarded when it wasn't.
    const { deleteDraft: mockDeleteDraft } = await import(
      "../content/EvaluateContent/actions"
    );
    vi.mocked(mockDeleteDraft).mockResolvedValueOnce({ ok: false, status: 500 });

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DRAFT_SCREEN } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    await waitFor(() => {
      expect(screen.getByText(/delete this draft/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /delete draft/i }));

    const alert = await screen.findByTestId("evaluate-draft-delete-error");
    expect(alert).toHaveTextContent(/couldn't discard that draft/i);
    expect(mockDeleteDraft).toHaveBeenCalled();
  });

  it("debounced server save is scheduled after draft changes", async () => {
    // The global setup pins Date via useFakeTimers({ toFake: ["Date"] }), so
    // reset to real first — a second useFakeTimers() while fake-Date is
    // already active doesn't re-apply the default setTimeout faking, and
    // advanceTimersByTime would only move Date forward.
    vi.useRealTimers();
    vi.useFakeTimers();

    const { saveDraft: mockSaveDraft, deleteDraft: mockDeleteDraft } = await import("../content/EvaluateContent/actions");
    vi.mocked(mockSaveDraft).mockResolvedValue({ status: "saved", id: "new-draft-id" });
    vi.mocked(mockDeleteDraft).mockResolvedValue({ ok: true });

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/drafts")) {
        return Promise.resolve({ ok: true, json: async () => ({ drafts: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ suggestion: null }) });
    });

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DRAFT_SCREEN } });

    await act(async () => {});

    await act(async () => {
      vi.advanceTimersByTime(21_000);
    });

    expect(mockSaveDraft).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ── Deep link from progress page: ?skill=<slug> ───────────────────────────────

describe("EvaluateContent — deep link ?skill=<slug>", () => {
  const originalLocation = window.location;
  let scrollSpy: ReturnType<typeof vi.fn>;
  const originalScroll = Element.prototype.scrollIntoView;

  function setSearch(search: string) {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { ...originalLocation, search, href: `http://localhost/${search}` },
    });
  }

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(submitEvaluation).mockResolvedValue({ status: "idle" });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestion: null }) });
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = originalScroll;
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: originalLocation,
    });
  });

  it("auto-selects the first matching screen when no draft is in progress", async () => {
    setSearch("?skill=back-kick");

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe(SCREEN_B_SLUG);
    });
  });

  it("scrolls to the skill when the current screen already contains it", async () => {
    // Restore the already-selected screen via localStorage so draft.screenSlug
    // is "freestyle" on first render.
    localStorage.setItem(metaKey(SWIMMER_ID), JSON.stringify({
      screenSlug: SCREEN_A_SLUG,
      sessionDate: "2026-10-14",
      context: "practice",
      coachingPriority: "",
      breathingPattern: "every_3",
    }));
    localStorage.setItem(skillsKey(SWIMMER_ID, SCREEN_A_SLUG), JSON.stringify({ skills: {} }));

    setSearch("?skill=free-kick");

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
      expect(scrollSpy.mock.calls.some((call) =>
        typeof call[0] === "object" && call[0].block === "center",
      )).toBe(true);
    });
  });

  it("does not touch an in-progress draft when the deep-linked skill belongs to a different screen", async () => {
    // Draft is in progress on freestyle. Click a backstroke-only skill link.
    localStorage.setItem(metaKey(SWIMMER_ID), JSON.stringify({
      screenSlug: SCREEN_A_SLUG,
      sessionDate: "2026-10-14",
      context: "practice",
      coachingPriority: "Keep this",
      breathingPattern: "every_3",
    }));
    localStorage.setItem(skillsKey(SWIMMER_ID, SCREEN_A_SLUG), JSON.stringify({ skills: {} }));
    setSearch("?skill=back-kick");

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} prevGrades={{}} />);

    // Priority stays — draft wasn't blown away.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/main focus/i)).toHaveValue("Keep this");
    });
    // Screen stayed on freestyle.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe(SCREEN_A_SLUG);
  });
});
