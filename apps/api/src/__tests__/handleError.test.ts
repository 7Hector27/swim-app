import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../middleware/errorHandler";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    requestId: "test-id-123",
    log: { error: vi.fn(), warn: vi.fn() },
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

  it("returns 413 with standard error shape for body-parser entity.too.large", () => {
    const req = makeReq();
    const res = makeRes();

    const err = Object.assign(new Error("request entity too large"), {
      type: "entity.too.large",
      status: 413,
      statusCode: 413,
    });
    errorHandler(err, req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: "Request body too large" });
    expect(req.log.error).not.toHaveBeenCalled();
  });

  it("returns 400 with standard error shape for malformed JSON", () => {
    const req = makeReq();
    const res = makeRes();

    const err = Object.assign(new Error("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
      statusCode: 400,
    });
    errorHandler(err, req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Malformed request body" });
  });

  it("does not shortcut a non-body-parser error that happens to carry status 400", () => {
    // Regression: a Supabase or Postgres error object may carry .status
    // or .statusCode === 400 without being a malformed-body error. Those
    // must go through the normal 500 error-log path, not get silently
    // relabelled as "malformed request body".
    const req = makeReq();
    const res = makeRes();

    const err = Object.assign(new Error("supabase auth rejected credentials"), {
      status: 400,
      statusCode: 400,
    });
    errorHandler(err, req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    expect(req.log.warn).not.toHaveBeenCalled();
    expect(req.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Error",
        message: expect.stringContaining("supabase auth rejected credentials"),
        requestId: "test-id-123",
      }),
      "Unhandled error",
    );
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
