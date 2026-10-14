// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifyOtp } = vi.hoisted(() => ({
  mockVerifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { verifyOtp: mockVerifyOtp },
  }),
}));

import { GET } from "../app/auth/confirm/route";

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    mockVerifyOtp.mockReset();
  });

  it("normal signup: verifies OTP and redirects to /dashboard", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?&token_hash=testhash&type=email",
    );
    const res = await GET(req);

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "testhash",
      type: "email",
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("invite signup: verifies OTP and redirects to returnTo", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?returnTo=%2Finvite%2Fabc&token_hash=testhash&type=email",
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/invite/abc");
  });

  it("missing token_hash: redirects to link-expired without calling verifyOtp", async () => {
    const req = new NextRequest("http://localhost:3000/auth/confirm?type=email");
    const res = await GET(req);

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("link-expired");
  });

  it("OTP verification error: redirects to link-expired", async () => {
    mockVerifyOtp.mockResolvedValue({ error: new Error("expired") });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?token_hash=bad&type=email",
    );
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("link-expired");
  });

  it("unsafe returnTo: ignores it and redirects to /dashboard", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?token_hash=h&type=email&returnTo=https%3A%2F%2Fevil.com",
    );
    const res = await GET(req);

    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });
});
