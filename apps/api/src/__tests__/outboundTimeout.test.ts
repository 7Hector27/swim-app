import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OUTBOUND_TIMEOUT_MS,
  OutboundTimeoutError,
  isAbortSignalTimeout,
  withTimeout,
} from "../lib/outboundTimeout";

describe("withTimeout", () => {
  beforeEach(() => {
    // Global setup fakes only Date. Reinstall with full fake timers so
    // setTimeout/advanceTimersByTimeAsync work for the race paths below.
    vi.useRealTimers();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the promise settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), "label", 100);
    expect(result).toBe("ok");
  });

  it("rejects with OutboundTimeoutError when the promise exceeds the timeout", async () => {
    const hanging = new Promise<string>(() => {});
    const raced = withTimeout(hanging, "google.events.insert", 10_000);
    const swallowed = raced.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(10_000);
    const err = await swallowed;
    expect(err).toBeInstanceOf(OutboundTimeoutError);
    expect(err).toMatchObject({
      label: "google.events.insert",
      timeoutMs: 10_000,
      name: "OutboundTimeoutError",
    });
  });

  it("defaults to OUTBOUND_TIMEOUT_MS (10s)", async () => {
    const hanging = new Promise<string>(() => {});
    const raced = withTimeout(hanging, "default");
    // Swallow the rejection so vitest doesn't flag an unhandled one.
    const swallowed = raced.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(OUTBOUND_TIMEOUT_MS);
    const err = await swallowed;
    expect(err).toBeInstanceOf(OutboundTimeoutError);
    expect((err as OutboundTimeoutError).timeoutMs).toBe(OUTBOUND_TIMEOUT_MS);
  });
});

describe("isAbortSignalTimeout", () => {
  it("returns true when the signal aborted with a TimeoutError reason", () => {
    const controller = new AbortController();
    controller.abort(new DOMException("timeout", "TimeoutError"));
    expect(isAbortSignalTimeout(controller.signal, new Error("fetch failed"))).toBe(true);
  });

  it("returns true when the caught error is an AbortError on an aborted signal", () => {
    const controller = new AbortController();
    controller.abort();
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isAbortSignalTimeout(controller.signal, err)).toBe(true);
  });

  it("returns false when the signal is not aborted", () => {
    const controller = new AbortController();
    expect(isAbortSignalTimeout(controller.signal, new Error("network"))).toBe(false);
  });

  it("returns false when the signal aborted for an unrelated reason", () => {
    const controller = new AbortController();
    controller.abort(new DOMException("user canceled", "AbortError"));
    // The reason is AbortError, not TimeoutError, AND the caught err is
    // not an AbortError — so this must not count as a timeout.
    expect(isAbortSignalTimeout(controller.signal, new Error("other"))).toBe(false);
  });
});
