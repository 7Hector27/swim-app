// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { MeResponse } from "@swim-app/shared";

const { mockSignInWithPassword, mockRedirect, mockFetchMe } = vi.hoisted(() => ({
  mockSignInWithPassword: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    // next/navigation's redirect throws so the caller never continues.
    const err = new Error(`NEXT_REDIRECT:${url}`);
    throw err;
  }),
  mockFetchMe: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { signInWithPassword: mockSignInWithPassword },
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, cache: (fn: unknown) => fn };
});

vi.mock("@/lib/api/me", () => ({ fetchMe: mockFetchMe }));

// Stub both dashboard content modules so the DashboardPage can render without
// pulling in every downstream server fetch. The returned <div> carries a
// data-shell attribute we can introspect from the rendered React element.
vi.mock("@/content/ParentDashboardContent", () => ({
  default: ({ profile }: { profile: MeResponse }) => (
    <div data-shell="parent" data-email={profile.email} />
  ),
}));
vi.mock("@/content/CoachDashboardContent", () => ({
  default: ({ accessToken }: { accessToken: string }) => (
    <div data-shell="coach" data-token={accessToken} />
  ),
}));

import { login } from "../content/LoginContent/actions";
import DashboardPage from "../app/dashboard/page";

const PARENT: MeResponse = {
  email: "hector@mail.com",
  fullName: "Hector Carbajal",
  phone: null,
  role: "parent",
};
const COACH: MeResponse = {
  email: "jason@mail.com",
  fullName: "Jason Guzman",
  phone: null,
  role: "coach",
};

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  mockSignInWithPassword.mockReset();
  mockRedirect.mockClear();
  mockFetchMe.mockReset();
});

describe("login action", () => {
  it("parent: signs in and redirects to /dashboard", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    const fd = formData({ email: PARENT.email, password: "TestPass!234" });

    await expect(login({ error: null }, fd)).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: PARENT.email,
      password: "TestPass!234",
    });
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("coach: signs in and redirects to /dashboard", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    const fd = formData({ email: COACH.email, password: "TestPass!234" });

    await expect(login({ error: null }, fd)).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("safe returnTo overrides /dashboard", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    const fd = formData({
      email: PARENT.email,
      password: "TestPass!234",
      returnTo: "/dashboard/lessons",
    });

    await expect(login({ error: null }, fd)).rejects.toThrow("NEXT_REDIRECT:/dashboard/lessons");
  });

  it("unsafe returnTo falls back to /dashboard", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    const fd = formData({
      email: PARENT.email,
      password: "TestPass!234",
      returnTo: "https://evil.example.com/steal",
    });

    await expect(login({ error: null }, fd)).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("bad credentials: returns error, no redirect", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid" } });
    const fd = formData({ email: PARENT.email, password: "wrong" });

    const result = await login({ error: null }, fd);

    expect(result.error).toBe("Email or password is incorrect.");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

import { renderToStaticMarkup } from "react-dom/server";

describe("dashboard page: first load after sign-in", () => {
  it("parent: renders the parent dashboard shell", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: PARENT, accessToken: "parent-tok" });

    const rendered = await DashboardPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain(`data-shell="parent"`);
    expect(html).toContain(`data-email="${PARENT.email}"`);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("coach: renders the coach dashboard shell", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: COACH, accessToken: "coach-tok" });

    const rendered = await DashboardPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain(`data-shell="coach"`);
    expect(html).toContain(`data-token="coach-tok"`);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("unauthenticated: redirects to /login", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 403 });

    // requireAuth returns null on 403; DashboardPage then calls redirect("/login").
    await expect(
      DashboardPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
