// Homepage CTA variant must use the same fail-safe owner/manager check as
// /dashboard and /dashboard/lessons/[id]: we only render the parent-active
// CTA (which links to Book) when we've confirmed owner/manager from the
// server. Load failure, null household, or a viewer role all fall through
// to parent-viewer so a transient outage never surfaces an unusable Book
// link.

import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockFetchMe, mockFetchHousehold } = vi.hoisted(() => ({
  mockFetchMe: vi.fn(),
  mockFetchHousehold: vi.fn(),
}));

vi.mock("@/lib/api/me", () => ({ fetchMe: mockFetchMe }));
vi.mock("@/lib/api/households", () => ({ fetchHousehold: mockFetchHousehold }));

const contentSpy = vi.fn();
vi.mock("@/content/HomepageContent", () => ({
  default: (props: { ctaVariant: string; isAuthenticatedParent: boolean }) => {
    contentSpy(props);
    return null;
  },
}));

const PARENT_ME = {
  ok: true as const,
  profile: {
    id: "parent-1",
    email: "parent@example.com",
    fullName: "Parent",
    phone: null,
    role: "parent" as const,
  },
  accessToken: "token",
};

async function renderHomepage() {
  const { default: HomePage } = await import("../app/page");
  const element = (await HomePage()) as React.ReactElement;
  // Server component returns the HomepageContent element; its props are
  // readable directly without React rendering.
  return (element.props as { ctaVariant: string }).ctaVariant;
}

beforeEach(() => {
  mockFetchMe.mockReset();
  mockFetchHousehold.mockReset();
  contentSpy.mockClear();
});

describe("Homepage CTA variant — parent household fail-safe", () => {
  it("falls back to parent-viewer when fetchHousehold fails", async () => {
    mockFetchMe.mockResolvedValue(PARENT_ME);
    mockFetchHousehold.mockResolvedValue({ ok: false, status: 500 });

    expect(await renderHomepage()).toBe("parent-viewer");
  });

  it("falls back to parent-viewer when household is null (unenrolled parent)", async () => {
    mockFetchMe.mockResolvedValue(PARENT_ME);
    mockFetchHousehold.mockResolvedValue({ ok: true, household: null });

    expect(await renderHomepage()).toBe("parent-viewer");
  });

  it("renders parent-viewer for viewer role", async () => {
    mockFetchMe.mockResolvedValue(PARENT_ME);
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

    expect(await renderHomepage()).toBe("parent-viewer");
  });

  it("renders parent-active only for owner", async () => {
    mockFetchMe.mockResolvedValue(PARENT_ME);
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

    expect(await renderHomepage()).toBe("parent-active");
  });

  it("renders parent-active for manager", async () => {
    mockFetchMe.mockResolvedValue(PARENT_ME);
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "manager",
        members: [],
        swimmerIds: [],
      },
    });

    expect(await renderHomepage()).toBe("parent-active");
  });
});
