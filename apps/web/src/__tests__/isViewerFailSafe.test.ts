// When /households/mine fails to load, both the parent dashboard and the
// lesson-detail page default isViewer to TRUE — we can't claim the parent
// is an owner/manager without reading that role back from the server. This
// is defense in depth: the API also enforces requireHouseholdRole("manager")
// on POST/DELETE/PATCH /lessons/:id, so a wrong default in the client
// would at worst show an action button that 403s server-side, but it's
// cleaner to hide the action in the first place.

import { vi, describe, it, expect, beforeEach } from "vitest";

const {
  mockNotFound,
  mockRedirect,
  mockRequireAuth,
  mockFetchSwimmers,
  mockFetchUpcomingLessons,
  mockFetchHousehold,
  mockFetchLesson,
  mockFetchClubs,
  mockFetchParentSwimmerSummaries,
  mockFetchLocations,
  mockFetchBatchCancelableLessons,
} = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  mockRequireAuth: vi.fn(),
  mockFetchSwimmers: vi.fn(),
  mockFetchUpcomingLessons: vi.fn(),
  mockFetchHousehold: vi.fn(),
  mockFetchLesson: vi.fn(),
  mockFetchClubs: vi.fn(),
  mockFetchParentSwimmerSummaries: vi.fn(),
  mockFetchLocations: vi.fn(),
  mockFetchBatchCancelableLessons: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}));
vi.mock("@/lib/requireAuth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/lib/api/swimmers", () => ({ fetchSwimmers: mockFetchSwimmers }));
vi.mock("@/lib/api/lessons", () => ({
  fetchUpcomingLessons: mockFetchUpcomingLessons,
  fetchLesson: mockFetchLesson,
  fetchLocations: mockFetchLocations,
  fetchBatchCancelableLessons: mockFetchBatchCancelableLessons,
}));
vi.mock("@/lib/api/households", () => ({ fetchHousehold: mockFetchHousehold }));
vi.mock("@/lib/api/clubs", () => ({ fetchClubs: mockFetchClubs }));
vi.mock("@/lib/api/parentProgress", () => ({
  fetchParentSwimmerSummaries: mockFetchParentSwimmerSummaries,
}));
vi.mock("@/content/ParentDashboardContent/BookingConfirmDialog", () => ({
  default: () => null,
}));
vi.mock("@/content/ParentDashboardContent/UpcomingLessonsCard", () => ({
  default: () => null,
}));
vi.mock("@/content/ParentDashboardContent/SwimmerCard", () => ({
  default: () => null,
}));

// LessonDetailContent is a client component with its own mocks requirements.
// We spy on its props to assert the isViewer value the server page passes.
const lessonDetailSpy = vi.fn();
vi.mock("@/content/LessonDetailContent", () => ({
  default: (props: { isViewer: boolean }) => {
    lessonDetailSpy(props);
    return null;
  },
}));

const PROFILE = {
  id: "parent-1",
  email: "parent@example.com",
  fullName: "Parent",
  phone: null,
  role: "parent" as const,
};
const AUTH = { profile: PROFILE, accessToken: "token" };
const LESSON_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  mockNotFound.mockClear();
  mockRedirect.mockClear();
  mockRequireAuth.mockReset();
  mockFetchSwimmers.mockReset();
  mockFetchUpcomingLessons.mockReset();
  mockFetchHousehold.mockReset();
  mockFetchLesson.mockReset();
  mockFetchClubs.mockReset();
  mockFetchParentSwimmerSummaries.mockReset();
  mockFetchLocations.mockReset();
  mockFetchBatchCancelableLessons.mockReset();
  lessonDetailSpy.mockClear();
  mockRequireAuth.mockResolvedValue(AUTH);
  mockFetchSwimmers.mockResolvedValue({ ok: true, data: [] });
  mockFetchUpcomingLessons.mockResolvedValue({
    ok: true,
    data: { items: [], total: 0 },
  });
  mockFetchClubs.mockResolvedValue({ ok: true, data: [] });
  mockFetchParentSwimmerSummaries.mockResolvedValue({
    ok: true,
    data: { summaries: [] },
  });
  mockFetchLocations.mockResolvedValue({ ok: true, data: [] });
  mockFetchBatchCancelableLessons.mockResolvedValue({ ok: true, data: [] });
});

describe("ParentDashboardContent — isViewer fail-safe default", () => {
  it("defaults isViewer to TRUE when the household fetch fails (hides Book)", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: false, status: 500 });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    const element = (await ParentDashboardContent({
      profile: PROFILE,
      accessToken: "token",
    })) as React.ReactElement;

    // Walk the rendered tree looking for the Book link / disabled Book
    // span. The Book link href is "/dashboard/book"; the viewer-disabled
    // variant uses aria-disabled="true" and does NOT link.
    const html = serializeReactTree(element);
    expect(html).toContain("aria-disabled");
    expect(html).not.toMatch(/href="\/dashboard\/book"/);
  });

  it("defaults isViewer to TRUE when household returns null (no household yet)", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: true, household: null });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    const element = (await ParentDashboardContent({
      profile: PROFILE,
      accessToken: "token",
    })) as React.ReactElement;

    const html = serializeReactTree(element);
    expect(html).toContain("aria-disabled");
    expect(html).not.toMatch(/href="\/dashboard\/book"/);
  });

  it("isViewer is FALSE only when household loaded and role is owner/manager", async () => {
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "owner",
        members: [],
        swimmerIds: [],
      },
    });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    const element = (await ParentDashboardContent({
      profile: PROFILE,
      accessToken: "token",
    })) as React.ReactElement;

    const html = serializeReactTree(element);
    expect(html).toMatch(/href="\/dashboard\/book"/);
  });

  it("isViewer is TRUE when role is viewer (existing behavior preserved)", async () => {
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "viewer",
        members: [],
        swimmerIds: [],
      },
    });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    const element = (await ParentDashboardContent({
      profile: PROFILE,
      accessToken: "token",
    })) as React.ReactElement;

    const html = serializeReactTree(element);
    expect(html).toContain("aria-disabled");
  });
});

describe("/dashboard/lessons/[id] — isViewer fail-safe default", () => {
  const LESSON = {
    id: LESSON_ID,
    type: "private" as const,
    status: "approved" as const,
    startsAt: "2027-01-15T18:00:00-08:00",
    durationMinutes: 45 as const,
    locationId: "loc-1",
    locationName: "Sunset Pool",
    swimmers: [],
    expiresAt: null,
    approvedAt: null,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: "2027-01-01T00:00:00Z",
    batchId: null,
    batchMode: null,
  };

  it("passes isViewer=true to the content when household fetch fails", async () => {
    mockFetchLesson.mockResolvedValue({ ok: true, lesson: LESSON });
    mockFetchHousehold.mockResolvedValue({ ok: false, status: 500 });

    const { default: LessonDetailPage } = await import(
      "../app/dashboard/lessons/[id]/page"
    );
    const element = (await LessonDetailPage({
      params: Promise.resolve({ id: LESSON_ID }),
    })) as React.ReactElement<{ isViewer: boolean }>;
    const props = element.props;
    expect(props.isViewer).toBe(true);
  });

  it("passes isViewer=true when household returns null (no household yet)", async () => {
    mockFetchLesson.mockResolvedValue({ ok: true, lesson: LESSON });
    mockFetchHousehold.mockResolvedValue({ ok: true, household: null });

    const { default: LessonDetailPage } = await import(
      "../app/dashboard/lessons/[id]/page"
    );
    const element = (await LessonDetailPage({
      params: Promise.resolve({ id: LESSON_ID }),
    })) as React.ReactElement<{ isViewer: boolean }>;
    const props = element.props;
    expect(props.isViewer).toBe(true);
  });

  it("passes isViewer=false when household loaded and role is owner", async () => {
    mockFetchLesson.mockResolvedValue({ ok: true, lesson: LESSON });
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "owner",
        members: [],
        swimmerIds: [],
      },
    });

    const { default: LessonDetailPage } = await import(
      "../app/dashboard/lessons/[id]/page"
    );
    const element = (await LessonDetailPage({
      params: Promise.resolve({ id: LESSON_ID }),
    })) as React.ReactElement<{ isViewer: boolean }>;
    const props = element.props;
    expect(props.isViewer).toBe(false);
  });

  it("passes isViewer=true when household loaded and role is viewer", async () => {
    mockFetchLesson.mockResolvedValue({ ok: true, lesson: LESSON });
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "viewer",
        members: [],
        swimmerIds: [],
      },
    });

    const { default: LessonDetailPage } = await import(
      "../app/dashboard/lessons/[id]/page"
    );
    const element = (await LessonDetailPage({
      params: Promise.resolve({ id: LESSON_ID }),
    })) as React.ReactElement<{ isViewer: boolean }>;
    const props = element.props;
    expect(props.isViewer).toBe(true);
  });
});

// Minimal recursive walker that serializes a server-rendered React tree into
// a string we can search for attributes/text. React's renderToString would be
// cleaner but pulls in a lot of machinery; this is enough for the attributes
// (aria-disabled, href) we're testing.
function serializeReactTree(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(serializeReactTree).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const elem = node as {
      type: unknown;
      props: Record<string, unknown> & { children?: unknown };
    };
    const attrs = Object.entries(elem.props)
      .filter(([key]) => key !== "children")
      .map(([key, value]) => {
        if (value === true) return key;
        if (value === false || value === null || value === undefined) return "";
        return `${key}="${String(value).replace(/"/g, "&quot;")}"`;
      })
      .filter(Boolean)
      .join(" ");
    const childrenStr = serializeReactTree(elem.props.children);
    const tag = typeof elem.type === "string" ? elem.type : "component";
    return `<${tag}${attrs ? " " + attrs : ""}>${childrenStr}</${tag}>`;
  }
  return "";
}
