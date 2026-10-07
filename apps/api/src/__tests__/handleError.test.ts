import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    requestId: "test-id-123",
    log: { error: vi.fn() },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

describe("errorHandler", () => {
  it("responds with 500 and a safe error body", () => {
    const req = makeReq();
    const res = makeRes();

    errorHandler(new Error("secret db details"), req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("does not leak internal error message or stack", () => {
    const req = makeReq();
    const res = makeRes();

    errorHandler(new Error("secret db details"), req, res, vi.fn() as unknown as NextFunction);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("secret db details");
    expect(body).not.toHaveProperty("stack");
  });

  it("logs the error with the request ID", () => {
    const req = makeReq();
    const res = makeRes();

    const err = new Error("boom");
    errorHandler(err, req, res, vi.fn() as unknown as NextFunction);

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err, requestId: "test-id-123" }),
      "Unhandled error",
    );
  });
});
