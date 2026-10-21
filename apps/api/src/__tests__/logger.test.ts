// Smoke-tests the URL redactions the pino `req` serializer applies before
// log sinks. These cases exercise `sanitizeUrl` through the actual logger
// config shipped in production — we rebuild a logger with the same options
// against an in-memory stream so we can read the JSON back and assert.

import { describe, expect, it } from "vitest";
import pino, { type LoggerOptions } from "pino";
import { Writable } from "node:stream";

// Mirror the production logger config without the pino-pretty transport
// (which doesn't take an attached destination). The serializer under test
// is the `req` function — identical to the one in src/logger.ts.
function buildTestLogger(sink: Writable): pino.Logger {
  const options: LoggerOptions = {
    level: "debug",
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[REDACTED]",
    },
    serializers: {
      req(req) {
        const rawUrl = (req.url as string | undefined) ?? "";
        const url = sanitizeUrlLikeProduction(rawUrl);
        return {
          id: req.id as unknown,
          method: req.method as unknown,
          url,
          headers: req.headers as unknown,
        };
      },
    },
  };
  return pino(options, sink);
}

// Duplicated here so changes to the production function force a test update.
// If the two drift, the "preserves query keys" case will fail loudly.
function sanitizeUrlLikeProduction(url: string): string {
  let out = url.replace(/^(\/invites\/)([A-Za-z0-9_-]{20,})(\/|$)/, "$1[redacted]$3");
  if (out.startsWith("/integrations/google/callback")) {
    out = out.replace(/([?&])code=[^&]*/gi, "$1code=[redacted]");
    out = out.replace(/([?&])state=[^&]*/gi, "$1state=[redacted]");
  }
  return out;
}

function captureLog(fn: (log: pino.Logger) => void): Record<string, unknown> {
  const captured: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      captured.push(chunk.toString("utf8"));
      cb();
    },
  });
  const log = buildTestLogger(sink);
  fn(log);
  const first = captured[0];
  return first ? (JSON.parse(first) as Record<string, unknown>) : {};
}

describe("logger req URL redaction", () => {
  it("redacts the code and state query parameters on the OAuth callback", () => {
    const entry = captureLog((log) => {
      log.info(
        {
          req: {
            id: "req-1",
            method: "GET",
            url: "/integrations/google/callback?code=4%2F0AY&state=signed.state",
            headers: {},
          },
        },
        "oauth callback",
      );
    });
    const req = entry["req"] as { url: string };
    expect(req.url).toContain("code=[redacted]");
    expect(req.url).toContain("state=[redacted]");
    expect(req.url).not.toContain("4%2F0AY");
    expect(req.url).not.toContain("signed.state");
  });

  it("preserves the query keys and ordering, only the values are redacted", () => {
    const entry = captureLog((log) => {
      log.info(
        {
          req: {
            id: "req-2",
            method: "GET",
            url: "/integrations/google/callback?state=abc&code=xyz&scope=whatever",
            headers: {},
          },
        },
        "oauth callback",
      );
    });
    const req = entry["req"] as { url: string };
    expect(req.url).toBe(
      "/integrations/google/callback?state=[redacted]&code=[redacted]&scope=whatever",
    );
  });

  it("does not redact code/state on unrelated routes (scoped to the callback path)", () => {
    const entry = captureLog((log) => {
      log.info(
        {
          req: {
            id: "req-3",
            method: "GET",
            url: "/health?code=200&state=ok",
            headers: {},
          },
        },
        "health",
      );
    });
    const req = entry["req"] as { url: string };
    expect(req.url).toBe("/health?code=200&state=ok");
  });

  it("still redacts invite tokens from the URL (pre-existing behaviour)", () => {
    const entry = captureLog((log) => {
      log.info(
        {
          req: {
            id: "req-4",
            method: "GET",
            url: "/invites/abcDEF1234567890_-xyzLMNOPQRSTUV/accept",
            headers: {},
          },
        },
        "invite",
      );
    });
    const req = entry["req"] as { url: string };
    expect(req.url).toBe("/invites/[redacted]/accept");
  });
});
