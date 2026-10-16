import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock SiteNav (server component) to avoid import errors
vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/AddNoteForm", () => ({ default: () => null }));
vi.mock("@/content/EvaluateContent/actions", () => ({
  submitEvaluation: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import GradeSelector from "../content/EvaluateContent/GradeSelector";
import SkillGradeRow from "../content/EvaluateContent/SkillGradeRow";
import CalculatedSkillRow from "../content/EvaluateContent/CalculatedSkillRow";
import StartGroupSection from "../content/EvaluateContent/StartGroupSection";
import UndoToast from "../content/EvaluateContent/UndoToast";
import EvaluateContent from "../content/EvaluateContent/EvaluateContent";
import { canSubmit, buildRatingsArray, defaultSkillDraft, initialSessionDraft } from "../content/EvaluateContent/helpers";
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

describe("canSubmit", () => {
  it("returns false when coachingPriority is empty", () => {
    const draft = { ...initialSessionDraft(), screenSlug: "freestyle", sessionDate: "2026-10-14", context: "practice" as const };
    expect(canSubmit(draft, 1, false)).toBe(false);
  });

  it("returns false when no ratings", () => {
    const draft = { ...initialSessionDraft(), screenSlug: "freestyle", sessionDate: "2026-10-14", context: "practice" as const, coachingPriority: "Fix kick" };
    expect(canSubmit(draft, 0, false)).toBe(false);
  });

  it("returns false when isPending", () => {
    const draft = { ...initialSessionDraft(), screenSlug: "freestyle", sessionDate: "2026-10-14", context: "practice" as const, coachingPriority: "Fix kick" };
    expect(canSubmit(draft, 1, true)).toBe(false);
  });

  it("returns true when all fields present", () => {
    const draft = { ...initialSessionDraft(), screenSlug: "freestyle", sessionDate: "2026-10-14", context: "practice" as const, coachingPriority: "Fix kick", breathingPattern: "every_3" as const };
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
    const grade2Button = screen.getByRole("radio", { name: "2" });
    expect(grade2Button).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /not legal/i }));
    expect(onChange).toHaveBeenCalledWith("skill-1", { notLegal: true });
  });

  it("shows DQ badge when draft.notLegal is true", () => {
    const onChange = vi.fn();
    const draft = { ...defaultSkillDraft(), grade: 2 as const, notLegal: true };
    render(<SkillGradeRow skill={SKILL} draftKey="skill-1" label="Kick" draft={draft} onChange={onChange} />);
    expect(screen.getByText("DQ")).toBeInTheDocument();
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
    expect(screen.getAllByText("DQ").length).toBeGreaterThanOrEqual(1);
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
  birthDate: "2015-01-01",
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

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} accessToken="tok" />);

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

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} accessToken="tok" />);

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

    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} accessToken="tok" />);

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
    localStorage.setItem(metaKey(SWIMMER_ID), JSON.stringify({
      screenSlug: SCREEN_A_SLUG,
      sessionDate: "2026-10-14",
      context: "practice",
      coachingPriority: "Fix kick",
      breathingPattern: null,
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
      <EvaluateContent swimmer={SWIMMER_DETAIL} screens={TEST_SCREENS} accessToken="tok" />,
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
        accessToken="tok"
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
        id: "skill-fp-2", slug: "fly-kick", name: "Kick",
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
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={freestyleScreens} accessToken="tok" />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "freestyle" } });
    await waitFor(() => {
      expect(screen.getByText("Breathing pattern")).toBeInTheDocument();
    });
  });

  it("shows breathing pattern selector for butterfly screen", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={freestyleScreens} accessToken="tok" />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "butterfly" } });
    await waitFor(() => {
      expect(screen.getByText("Breathing pattern")).toBeInTheDocument();
    });
  });

  it("does not show breathing pattern selector for backstroke screen", async () => {
    render(<EvaluateContent swimmer={SWIMMER_DETAIL} screens={freestyleScreens} accessToken="tok" />);
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
