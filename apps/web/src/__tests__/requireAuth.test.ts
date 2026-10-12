import { vi, describe, expect, it, beforeEach } from "vitest";

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, cache: (fn: unknown) => fn };
});

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/api/me", () => ({ fetchMe: vi.fn() }));

import { redirect } from "next/navigation";
import type { Mock } from "vitest";
import { fetchMe } from "@/lib/api/me";
import { requireAuth } from "../lib/requireAuth";

const mockFetchMe = fetchMe as Mock;
const mockRedirect = redirect as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  // next/navigation redirect throws in real Next.js; simulate that so execution stops.
  mockRedirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("requireAuth", () => {
  it("redirects to /api/signout on 401 to break the stale-session loop", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 401 });
    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/api/signout");
  });

  it("returns null on 403", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 403 });
    const result = await requireAuth();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns profile and accessToken on 200", async () => {
    const profile = { email: "a@b.com", fullName: "Jane", phone: null, role: "parent" as const };
    mockFetchMe.mockResolvedValue({ ok: true, profile, accessToken: "tok-abc" });
    const result = await requireAuth();
    expect(result).toEqual({ profile, accessToken: "tok-abc" });
  });

  it("throws on unexpected error status", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 500 });
    await expect(requireAuth()).rejects.toThrow("Failed to load session (status 500)");
  });
});
