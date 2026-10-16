import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api/evaluations", () => ({
  fetchSkillRatingHistory: vi.fn(),
  voidRating: vi.fn(),
}));

import { fetchSkillRatingHistory, voidRating } from "../lib/api/evaluations";
import SwimmerSkillsHistory from "../content/CoachSwimmerDetailContent/SwimmerSkillsHistory";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SWIMMER_ID = "00000000-0000-0000-aaaa-000000000001";
const CAT_ID = "00000000-0000-0000-bbbb-000000000001";
const SKILL_ID = "00000000-0000-0000-cccc-000000000001";
const RATING_ID = "00000000-0000-0000-dddd-000000000001";
const SESSION_ID = "00000000-0000-0000-eeee-000000000001";
const COACH_ID = "00000000-0000-0000-ffff-000000000001";

const TEST_CATEGORIES = [
  {
    id: CAT_ID,
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
        descriptors: [],
      },
    ],
  },
];

const TEST_GRADES: Record<string, number | "not_legal" | "no_concept"> = {
  "flutter-kick": 3,
};

const TEST_RATING = {
  id: RATING_ID,
  sessionId: SESSION_ID,
  swimmerId: SWIMMER_ID,
  skillId: SKILL_ID,
  coachId: COACH_ID,
  grade: 3,
  notLegal: false,
  noConcept: false,
  side: null,
  capacityValue: null,
  capacityUnit: null,
  measurementValue: null,
  measurementUnit: null,
  voidedAt: null,
  voidReason: null,
  voidBy: null,
  note: null,
  ratedAt: "2024-06-01T10:00:00Z",
  createdAt: "2024-06-01T10:00:00Z",
  updatedAt: "2024-06-01T10:00:00Z",
};

const mockFetch = fetchSkillRatingHistory as ReturnType<typeof vi.fn>;
const mockVoid = voidRating as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SwimmerSkillsHistory", () => {
  it("renders the rated skill name", () => {
    render(
      <SwimmerSkillsHistory
        swimmerId={SWIMMER_ID}
        accessToken="test-token"
        categories={TEST_CATEGORIES}
        grades={TEST_GRADES}
      />,
    );
    expect(screen.getByText("Flutter Kick")).toBeInTheDocument();
  });

  it("shows the grade badge for the current grade", () => {
    render(
      <SwimmerSkillsHistory
        swimmerId={SWIMMER_ID}
        accessToken="test-token"
        categories={TEST_CATEGORIES}
        grades={TEST_GRADES}
      />,
    );
    // Grade badge shows "3"
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("expands skill row and shows rating history after fetch", async () => {
    mockFetch.mockResolvedValue({ ok: true, ratings: [TEST_RATING] });

    render(
      <SwimmerSkillsHistory
        swimmerId={SWIMMER_ID}
        accessToken="test-token"
        categories={TEST_CATEGORIES}
        grades={TEST_GRADES}
      />,
    );

    // Click the skill row button to expand
    fireEvent.click(screen.getByRole("button", { name: /flutter kick/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        SWIMMER_ID,
        SKILL_ID,
        "test-token",
      );
    });

    // After loading, a "Void" button should appear (non-voided rating)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument();
    });
  });

  it("void button appears for non-voided rating; clicking shows void form", async () => {
    mockFetch.mockResolvedValue({ ok: true, ratings: [TEST_RATING] });

    render(
      <SwimmerSkillsHistory
        swimmerId={SWIMMER_ID}
        accessToken="test-token"
        categories={TEST_CATEGORIES}
        grades={TEST_GRADES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /flutter kick/i }));

    // Wait for the Void button
    const voidBtn = await screen.findByRole("button", { name: /^void$/i });
    expect(voidBtn).toBeInTheDocument();

    // Click Void to open the form
    fireEvent.click(voidBtn);

    expect(screen.getByPlaceholderText(/reason/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /void rating/i }),
    ).toBeInTheDocument();
  });

  it("void form submit calls voidRating with ratingId and reason", async () => {
    mockVoid.mockResolvedValue({ ok: true });
    // First expand fetch returns the rating; after void, re-fetch returns empty list
    mockFetch
      .mockResolvedValueOnce({ ok: true, ratings: [TEST_RATING] })
      .mockResolvedValue({ ok: true, ratings: [] });

    render(
      <SwimmerSkillsHistory
        swimmerId={SWIMMER_ID}
        accessToken="test-token"
        categories={TEST_CATEGORIES}
        grades={TEST_GRADES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /flutter kick/i }));

    const voidBtn = await screen.findByRole("button", { name: /^void$/i });
    fireEvent.click(voidBtn);

    const textarea = screen.getByPlaceholderText(/reason/i);
    fireEvent.change(textarea, { target: { value: "Data entry error" } });

    const submitBtn = screen.getByRole("button", { name: /void rating/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockVoid).toHaveBeenCalledWith(
        RATING_ID,
        "Data entry error",
        "test-token",
      );
    });
  });
});
