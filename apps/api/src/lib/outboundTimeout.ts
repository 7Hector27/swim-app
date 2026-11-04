// Shared timeout for every outbound call (Resend, Google Calendar). 10s
// is shorter than the lesson-email claim lease (2 min) so a stuck provider
// becomes a transient failure the outbox retries on the next tick rather
// than tying up a worker until the SDK's default (minutes or forever).
export const OUTBOUND_TIMEOUT_MS = 10_000;

export class OutboundTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;
  constructor(label: string, timeoutMs: number) {
    super(`outbound timeout after ${timeoutMs}ms: ${label}`);
    this.name = "OutboundTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race `promise` against a timeout. If `timeoutMs` elapses first, the
 * returned promise rejects with `OutboundTimeoutError`. The underlying
 * promise is NOT cancelled — SDKs that need cancellation should additionally
 * accept an AbortSignal (see transport.ts for Resend).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number = OUTBOUND_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new OutboundTimeoutError(label, timeoutMs)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  });
}

/**
 * True when `err` is an aborted-by-timeout signal error. Handles the
 * AbortSignal.timeout() path: the signal aborts with
 * `reason.name === "TimeoutError"` (DOMException).
 */
export function isAbortSignalTimeout(signal: AbortSignal, err: unknown): boolean {
  if (!signal.aborted) return false;
  const reason = signal.reason as { name?: unknown } | null | undefined;
  if (reason && typeof reason === "object" && (reason as { name?: unknown }).name === "TimeoutError") {
    return true;
  }
  // Some fetch implementations surface the abort as an AbortError on the
  // caught error rather than preserving the signal.reason. Treat that as
  // a timeout too since the signal was aborted.
  const name = err instanceof Error ? err.name : undefined;
  return name === "AbortError" || name === "TimeoutError";
}
