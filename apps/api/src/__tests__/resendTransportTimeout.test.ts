import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResendTransport } from "../services/emails/transport";

// Mock the Resend SDK so emails.send honors the AbortSignal passed in
// the second argument. The transport builds a signal via
// AbortSignal.timeout(OUTBOUND_TIMEOUT_MS); we spy on that path by
// returning a promise that rejects when the signal aborts.
vi.mock("resend", () => {
  const sendImpl = vi.fn(
    (
      _payload: unknown,
      options: { signal?: AbortSignal; idempotencyKey?: string },
    ) =>
      new Promise((_resolve, reject) => {
        if (!options.signal) {
          reject(new Error("test: Resend SDK was called without a signal"));
          return;
        }
        if (options.signal.aborted) {
          reject(signalToError(options.signal));
          return;
        }
        options.signal.addEventListener(
          "abort",
          () => reject(signalToError(options.signal!)),
          { once: true },
        );
      }),
  );
  function signalToError(signal: AbortSignal): Error {
    const reason = signal.reason as { name?: string } | undefined;
    if (reason?.name === "TimeoutError") {
      return Object.assign(new Error("fetch failed"), { name: "TimeoutError" });
    }
    return Object.assign(new Error("aborted"), { name: "AbortError" });
  }
  class Resend {
    emails = { send: sendImpl };
  }
  return { Resend };
});

describe("ResendTransport timeout", () => {
  beforeEach(() => {
    // Global setup fakes only Date; reinstall full fake timers.
    vi.useRealTimers();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out at 10s and returns kind=server so the outbox retries", async () => {
    const transport = new ResendTransport("re_test");
    const resultPromise = transport.send({
      from: "Axiom <lessons@send.axiomaquatics.io>",
      replyTo: undefined,
      to: ["parent@example.com"],
      subject: "Hi",
      text: "hi",
      idempotencyKey: "outbox-row-id-123",
    });

    // Advance past the 10s outbound timeout.
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ kind: "server" });
    expect(result.errorMessage).toContain("timeout:");
    expect(result.providerMessageId).toBeNull();
  });
});
