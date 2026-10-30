import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type {
  CoachSwimmerDetail,
  GetSessionResponse,
  ScreensResponse,
} from "@swim-app/shared";

vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/AddNoteForm", () => ({ default: () => null }));

vi.mock("@/content/EvaluateContent/actions", () => ({
  submitEvaluation: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  fetchDependencyMapAction: vi.fn().mockResolvedValue({ ok: false }),
  fetchServerDraftsAction: vi.fn().mockResolvedValue([]),
  deleteSessionAction: vi.fn().mockResolvedValue({ ok: true }),
  patchSessionAction: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import EvaluateContent from "../content/EvaluateContent/EvaluateContent";
import {
  patchSessionAction,
  fetchServerDraftsAction,
  saveDraft,
} from "../content/EvaluateContent/actions";

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const SKILL_ID = "cccc0000-0000-0000-0000-000000000001";
const RATING_ID = "rrrr0000-0000-0000-0000-000000000001";
const SESSION_ID = "ssss0000-0000-0000-0000-000000000001";

const SWIMMER: CoachSwimmerDetail = {
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

const SCREENS: ScreensResponse = [
  {
    screenSlug: "freestyle",
    name: "Freestyle",
    skills: [
      {
        id: SKILL_ID,
        slug: "free-kick",
        name: "Freestyle Kick",
        type: "rubric",
        unit: null,
        stroke: null,
        ratedPerSide: false,
        notLegalAllowed: true,
        parentSkillId: null,
        sortOrder: 1,
        faultTags: [],
        descriptors: [],
      },
    ],
  },
  {
    screenSlug: "backstroke",
    name: "Backstroke",
    skills: [
      {
        id: "cccc0000-0000-0000-0000-000000000002",
        slug: "back-kick",
        name: "Backstroke Kick",
        type: "rubric",
        unit: null,
        stroke: null,
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

function makeEditSession(overrides: Partial<GetSessionResponse> = {}): GetSessionResponse {
  return {
    sessionId: SESSION_ID,
    screenSlug: "freestyle",
    swimmerId: SWIMMER_ID,
    categoryId: null,
    sessionDate: "2026-10-14",
    context: "practice",
    coachingPriority: "Fix the kick",
    breathingPattern: "every_3",
    edited: false,
    editedAt: null,
    ratings: [
      {
        ratingId: RATING_ID,
        rootRatingId: RATING_ID,
        skillId: SKILL_ID,
        slug: "free-kick",
        grade: 3,
        notLegal: false,
        noConcept: false,
        side: null,
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        golfScoreCategory: null,
        note: null,
        faultTags: [],
        ratedAt: "2026-10-14T18:00:00.000Z",
        edited: false,
      },
    ],
    ...overrides,
  };
}

describe("EvaluateContent — edit mode (ADR 032)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(patchSessionAction).mockResolvedValue({ status: "idle" });
    vi.mocked(fetchServerDraftsAction).mockResolvedValue([]);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestion: null }) });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the resolved screen as a read-only pill (no select)", async () => {
    render(
      <EvaluateContent
        swimmer={SWIMMER}
        screens={SCREENS}
        prevGrades={{}}
        editSession={makeEditSession()}
        returnTo={`/coach/swimmers/${SWIMMER_ID}/progress`}
      />,
    );
    await act(async () => {});
    const pill = screen.getByTestId("session-setup-screen-pill");
    expect(pill).toHaveTextContent("Freestyle");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it('submit button says "Save changes"', async () => {
    render(
      <EvaluateContent
        swimmer={SWIMMER}
        screens={SCREENS}
        prevGrades={{}}
        editSession={makeEditSession()}
        returnTo={`/coach/swimmers/${SWIMMER_ID}`}
      />,
    );
    await act(async () => {});
    expect(screen.getByTestId("evaluate-submit-button")).toHaveTextContent(/save changes/i);
  });

  it("hides the server-draft banner and Save as draft action in edit mode", async () => {
    // Even when the server reports a saved draft for this screen, edit mode
    // must not surface the banner.
    vi.mocked(fetchServerDraftsAction).mockResolvedValue([
      {
        id: "draft-1",
        swimmerId: SWIMMER_ID,
        screenSlug: "freestyle",
        sessionDate: "2026-10-14",
        context: "practice",
        coachingPriority: "Different priority",
        breathingPattern: "every_3",
        payload: {},
        createdAt: "2026-10-20T17:00:00.000Z",
        updatedAt: "2026-10-20T18:00:00.000Z",
      },
    ]);

    render(
      <EvaluateContent
        swimmer={SWIMMER}
        screens={SCREENS}
        prevGrades={{}}
        editSession={makeEditSession()}
        returnTo={`/coach/swimmers/${SWIMMER_ID}`}
      />,
    );
    await act(async () => {});
    expect(screen.queryByText(/saved draft from/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save as draft/i })).toBeNull();
  });

  it("does not write draft keys to localStorage in edit mode", async () => {
    render(
      <EvaluateContent
        swimmer={SWIMMER}
        screens={SCREENS}
        prevGrades={{}}
        editSession={makeEditSession()}
        returnTo={`/coach/swimmers/${SWIMMER_ID}`}
      />,
    );
    // Nudge the draft by clicking a grade; the create-mode effect would
    // otherwise persist to localStorage on this change.
    const grade4 = screen.getAllByRole("radio", { name: "4" })[0];
    if (grade4) fireEvent.click(grade4);
    await act(async () => {});

    const metaKey = `evaluate-draft-meta-${SWIMMER_ID}`;
    const skillsKey = `evaluate-draft-skills-${SWIMMER_ID}-freestyle`;
    expect(localStorage.getItem(metaKey)).toBeNull();
    expect(localStorage.getItem(skillsKey)).toBeNull();
    // Debounced server autosave is also suppressed.
    expect(vi.mocked(saveDraft)).not.toHaveBeenCalled();
  });

  it("shows the stale-edit banner when the action returns status 'stale'", async () => {
    vi.mocked(patchSessionAction).mockResolvedValue({ status: "stale" });
    const { container } = render(
      <EvaluateContent
        swimmer={SWIMMER}
        screens={SCREENS}
        prevGrades={{}}
        editSession={makeEditSession()}
        returnTo={`/coach/swimmers/${SWIMMER_ID}`}
      />,
    );
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    await waitFor(() => {
      expect(screen.getByTestId("evaluate-stale-banner")).toBeInTheDocument();
    });
  });

  it("pre-fills ratings from the fetched session", async () => {
    render(
      <EvaluateContent
        swimmer={SWIMMER}
        screens={SCREENS}
        prevGrades={{}}
        editSession={makeEditSession()}
        returnTo={`/coach/swimmers/${SWIMMER_ID}`}
      />,
    );
    await act(async () => {});
    // The grade-3 button for the pre-filled rating should be selected.
    const grade3Buttons = screen.getAllByRole("radio", { name: "3" });
    expect(grade3Buttons.some((btn) => btn.getAttribute("aria-checked") === "true")).toBe(true);
  });
});
