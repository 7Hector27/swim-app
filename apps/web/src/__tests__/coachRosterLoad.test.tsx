// @vitest-environment node
import { vi, it, expect, describe, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachSwimmer, MeResponse } from "@swim-app/shared";

const { mockFetchMe, mockFetchCoachSwimmers, mockRedirect } = vi.hoisted(() => ({
  mockFetchMe: vi.fn(),
  mockFetchCoachSwimmers: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    throw err;
  }),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, cache: (fn: unknown) => fn };
});

vi.mock("@/lib/api/me", () => ({ fetchMe: mockFetchMe }));
vi.mock("@/lib/api/coachSwimmers", () => ({ fetchCoachSwimmers: mockFetchCoachSwimmers }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("@/content/CoachRosterContent", () => ({
  default: ({ swimmers }: { swimmers: CoachSwimmer[] }) => (
    <ul data-testid="roster">
      {swimmers.map((swimmer) => (
        <li key={swimmer.id} data-swimmer-id={swimmer.id}>
          {swimmer.firstName} {swimmer.lastName}
        </li>
      ))}
    </ul>
  ),
}));

import CoachSwimmersPage from "../app/coach/swimmers/page";

const COACH: MeResponse = {
  email: "jason@mail.com",
  fullName: "Jason Guzman",
  phone: null,
  role: "coach",
};

const SWIMMER: CoachSwimmer = {
  id: "sw-001",
  firstName: "Alex",
  lastName: "Rivera",
  age: 12,
  sex: "male",
  isPublic: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
  memberNames: ["Jordan Rivera"],
};

beforeEach(() => {
  mockFetchMe.mockReset();
  mockFetchCoachSwimmers.mockReset();
  mockRedirect.mockClear();
});

describe("CoachSwimmersPage — data load", () => {
  it("calls fetchCoachSwimmers with the session token", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSwimmers.mockResolvedValue([SWIMMER]);

    await CoachSwimmersPage();

    expect(mockFetchCoachSwimmers).toHaveBeenCalledWith("coach-tok");
  });

  it("renders swimmer data returned by fetchCoachSwimmers", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSwimmers.mockResolvedValue([SWIMMER]);

    const rendered = await CoachSwimmersPage();
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain("Alex Rivera");
    expect(html).toContain(`data-swimmer-id="sw-001"`);
  });

  it("renders an empty roster when fetchCoachSwimmers returns []", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });
    mockFetchCoachSwimmers.mockResolvedValue([]);

    const rendered = await CoachSwimmersPage();
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain(`data-testid="roster"`);
    expect(html).not.toContain("Alex Rivera");
  });

  it("returns null when requireAuth returns null (forbidden)", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 403 });

    const rendered = await CoachSwimmersPage();

    expect(rendered).toBeNull();
    expect(mockFetchCoachSwimmers).not.toHaveBeenCalled();
  });
});
