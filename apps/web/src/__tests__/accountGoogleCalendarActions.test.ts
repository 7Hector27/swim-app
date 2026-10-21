import { vi, describe, it, expect, beforeEach } from "vitest";

// next/navigation's real `redirect` throws a special error so control never
// returns to the caller. The mock mimics that so tests see the final
// redirect call and the action short-circuits as it does in production.
const { mockRedirect, mockGetSession, mockFetch, mockRevalidatePath } = vi.hoisted(() => ({
  mockRedirect: vi.fn((_url: string) => {
    throw new Error("NEXT_REDIRECT_MOCK");
  }),
  mockGetSession: vi.fn(),
  mockFetch: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

async function expectRedirectThrows(fn: () => Promise<void>): Promise<void> {
  await expect(fn()).rejects.toThrow("NEXT_REDIRECT_MOCK");
}

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getSession: mockGetSession },
  }),
}));
vi.mock("@/lib/logout", () => ({ logout: vi.fn() }));

global.fetch = mockFetch;

import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  retryAllFailedGoogleCalendarSync,
} from "../content/AccountContent/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

describe("connectGoogleCalendar", () => {
  it("redirects to the Google authorize URL on success", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }),
    });

    await expectRedirectThrows(() => connectGoogleCalendar());

    expect(mockRedirect).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1");
  });

  it("redirects with ?google=error (not start_failed) when the start endpoint returns non-200", async () => {
    mockFetch.mockResolvedValue({ status: 503, ok: false });

    await expectRedirectThrows(() => connectGoogleCalendar());

    expect(mockRedirect).toHaveBeenCalledWith("/account?google=error");
    // The non-200 path still revalidates /account so the card re-fetches
    // status (e.g., the integration config may have changed).
    expect(mockRevalidatePath).toHaveBeenCalledWith("/account");
  });

  it("redirects with ?google=error when the response body is missing authorizeUrl", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ not: "a url" }),
    });

    await expectRedirectThrows(() => connectGoogleCalendar());

    expect(mockRedirect).toHaveBeenCalledWith("/account?google=error");
  });
});

describe("disconnectGoogleCalendar", () => {
  it("revalidates /account and does not redirect on success (204)", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await disconnectGoogleCalendar();

    expect(mockRevalidatePath).toHaveBeenCalledWith("/account");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /account?google=disconnect_error when the DELETE returns a non-2xx", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expectRedirectThrows(() => disconnectGoogleCalendar());

    expect(mockRevalidatePath).toHaveBeenCalledWith("/account");
    expect(mockRedirect).toHaveBeenCalledWith("/account?google=disconnect_error");
  });

  it("redirects to /account?google=disconnect_error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    await expectRedirectThrows(() => disconnectGoogleCalendar());

    expect(mockRevalidatePath).toHaveBeenCalledWith("/account");
    expect(mockRedirect).toHaveBeenCalledWith("/account?google=disconnect_error");
  });
});

describe("retryAllFailedGoogleCalendarSync", () => {
  it("POSTs to the retry endpoint with the bearer token and revalidates /account", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await retryAllFailedGoogleCalendarSync();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/coach/calendar/retry-failed"),
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer tok" } }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/account");
  });

  it("still revalidates /account when the retry fetch throws (no surfaced error)", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    await retryAllFailedGoogleCalendarSync();

    expect(mockRevalidatePath).toHaveBeenCalledWith("/account");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
