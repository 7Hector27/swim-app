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

  it("does not leak internal error message or stack to the response", () => {
    const req = makeReq();
    const res = makeRes();

    errorHandler(new Error("secret db details"), req, res, vi.fn() as unknown as NextFunction);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("secret db details");
    expect(body).not.toHaveProperty("stack");
  });

  it("logs name, message, stack, and request id (not the raw err)", () => {
    const req = makeReq();
    const res = makeRes();

    const err = new Error("boom");
    errorHandler(err, req, res, vi.fn() as unknown as NextFunction);

    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Error",
        message: "boom",
        requestId: "test-id-123",
        stack: expect.stringContaining("boom"),
      }),
      "Unhandled error",
    );
    const payload = (req.log.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    // The raw err object must not be in the log payload — pino would
    // serialize it whole and defeat the redaction.
    expect(payload).not.toHaveProperty("err");
  });

  it("redacts email addresses from the logged message", () => {
    const req = makeReq();
    const res = makeRes();

    const err = new Error(
      "duplicate key value violates unique constraint: email=parent@example.com",
    );
    errorHandler(err, req, res, vi.fn() as unknown as NextFunction);

    const payload = (req.log.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      message: string;
    };
    expect(payload.message).toContain("[email]");
    expect(payload.message).not.toContain("parent@example.com");
  });

  it("truncates long messages", () => {
    const req = makeReq();
    const res = makeRes();

    const longPayload = "x".repeat(1000);
    errorHandler(new Error(longPayload), req, res, vi.fn() as unknown as NextFunction);

    const payload = (req.log.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      message: string;
    };
    expect(payload.message.length).toBeLessThanOrEqual(200);
  });

  it("handles non-Error thrown values without crashing", () => {
    const req = makeReq();
    const res = makeRes();

    errorHandler("raw string", req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = (req.log.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      name: string;
      message: string;
    };
    expect(payload.name).toBe("UnknownError");
    expect(payload.message).toBe("raw string");
  });
});
