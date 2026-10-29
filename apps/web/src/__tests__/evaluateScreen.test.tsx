import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock SiteNav (server component) to avoid import errors
vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/AddNoteForm", () => ({ default: () => null }));
vi.mock("@/content/EvaluateContent/actions", () => ({
  submitEvaluation: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
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
import SectionTabs from "../content/EvaluateContent/SectionTabs";
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

// ── SectionTabs ───────────────────────────────────────────────────────────────

describe("SectionTabs", () => {
  const TEST_SECTIONS = [
    { name: "Start", count: 2, completed: 0 },
    { name: "Underwaters", count: 2, completed: 1 },
    { name: "Breakout", count: 1, completed: 0 },
  ];

  it("scrolls the active tab into view when activeIndex changes, but not on first mount", () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;

    try {
      const { rerender } = render(
        <SectionTabs sections={TEST_SECTIONS} activeIndex={0} onSelect={() => {}} />,
      );
      // First mount: no scroll (don't jiggle the strip on page load).
      expect(spy).not.toHaveBeenCalled();

      rerender(
        <SectionTabs sections={TEST_SECTIONS} activeIndex={2} onSelect={() => {}} />,
      );
      // Switching to a different tab (as validation-jump does): scroll it in.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ inline: "nearest", block: "nearest" }),
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("hides the scrollbar via the reusable utility class", () => {
    render(<SectionTabs sections={TEST_SECTIONS} activeIndex={0} onSelect={() => {}} />);
    const nav = screen.getByRole("navigation", { name: /evaluation sections/i });
    expect(nav.className).toMatch(/\bscrollbar-none\b/);
  });

  it("honors prefers-reduced-motion when scrolling into view", () => {
    const spy = vi.fn();
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
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

    try {
      const { rerender } = render(
        <SectionTabs sections={TEST_SECTIONS} activeIndex={0} onSelect={() => {}} />,
      );
      rerender(
        <SectionTabs sections={TEST_SECTIONS} activeIndex={1} onSelect={() => {}} />,
      );
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    } finally {
      Element.prototype.scrollIntoView = originalScroll;
      matchMediaSpy.mockRestore();
    }
  });
});

// ── Pre-save client validation ────────────────────────────────────────────────

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

  it("debounced server save is scheduled after draft changes", async () => {
    vi.useFakeTimers();

    const { saveDraft: mockSaveDraft, deleteDraft: mockDeleteDraft } = await import("../content/EvaluateContent/actions");
    vi.mocked(mockSaveDraft).mockResolvedValue({ status: "saved", id: "new-draft-id" });
    vi.mocked(mockDeleteDraft).mockResolvedValue(undefined);

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
