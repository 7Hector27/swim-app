"use client";

import { useEffect, useRef, useState } from "react";

import type { GoogleCalendarStatusResponse, RetryAllFailedResponse } from "@swim-app/shared";

import Button from "@/components/Button";

interface SyncingStateProps {
  initial: GoogleCalendarStatusResponse;
}

// Two tones only. The design system has no amber/warning token
// (needs_reconnect, a true warning state, also renders in text-danger),
// so a third tone would collapse to text-danger at render anyway. If a
// warning token is added later, "partial success" is where it belongs
// — see formatRetryResult.
type RetryTone = "success" | "error";
interface RetryResult {
  message: string;
  tone: RetryTone;
}

// How often to poll the status endpoint while a sync run is in progress on
// the server. Matches the server-side 2-minute staleness window with
// headroom; a 3s cadence is cheap and shows progress reliably on jittery
// connections.
const STATUS_POLL_INTERVAL_MS = 3000;

// Shorter cadence specifically for the post-retry drain: once we have the
// retry response in hand, we're polling only to confirm the server-side
// run marker cleared. 1s keeps the pending state short.
const RETRY_DRAIN_INTERVAL_MS = 1000;

// Hard ceiling on the post-retry drain. The server already awaited the
// batch before responding; this only guards against a stale run marker.
const RETRY_DRAIN_TIMEOUT_MS = 10_000;

/**
 * The counts portion of the active calendar card: syncing banner, the
 * failed-chip retry row, and the retry result message. Retry is a
 * client-side fetch (not a server action) so:
 *   - the button can show a pending state while the request is in flight,
 *   - a result message can live in client state across status refreshes,
 *   - no revalidatePath call wipes that state.
 *
 * The retry endpoint awaits the full light-pass batch before returning,
 * so in the common case the result is read directly from the response.
 * As a defense against a server-side run marker that lingers (e.g. a
 * mid-batch crash cleared by the 2-minute staleness window), we poll
 * status briefly after the response until syncRunInProgress is false.
 */
export default function SyncingState({ initial }: SyncingStateProps) {
  const [status, setStatus] = useState(initial);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<RetryResult | null>(null);
  // Guards against a lingering retry handler committing state after the
  // component unmounts (e.g. the user navigates away mid-poll).
  const isMounted = useRef(true);
  useEffect(() => () => {
    isMounted.current = false;
  }, []);

  const serverRunInProgress = status.syncRunInProgress;

  // Server-driven polling: whenever the server reports a run in progress
  // (either from the initial SSR response or from the last client-side
  // status fetch), tick every 3s to refresh counts. Independent of the
  // retry handler's own short-interval drain poll — the useEffect lives
  // for background sync runs started elsewhere (connect, cron).
  useEffect(() => {
    if (!serverRunInProgress) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as GoogleCalendarStatusResponse;
        if (!cancelled) setStatus(body);
      } catch {
        // Transient fetch error — next tick retries.
      }
    };
    const timer = window.setInterval(() => { void tick(); }, STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serverRunInProgress]);

  const totalDone = status.syncedCount + status.failedLessonCount;

  async function fetchStatus(): Promise<GoogleCalendarStatusResponse | null> {
    try {
      const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as GoogleCalendarStatusResponse;
    } catch {
      return null;
    }
  }

  // Poll until the server reports no run in progress, or until the deadline.
  // Each successful status read also refreshes the component's status so
  // the banner's "Syncing N of M…" numbers tick up.
  async function drainStatusUntilIdle(): Promise<void> {
    const deadline = Date.now() + RETRY_DRAIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const fresh = await fetchStatus();
      if (fresh !== null && isMounted.current) {
        setStatus(fresh);
        if (!fresh.syncRunInProgress) return;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DRAIN_INTERVAL_MS));
    }
  }

  async function handleRetry(): Promise<void> {
    if (isRetrying) return;
    setIsRetrying(true);
    // Clear any stale result from a previous retry so the user sees the
    // pending state alone until this run has an answer of its own.
    setRetryResult(null);

    let retryBody: RetryAllFailedResponse | null = null;
    let errorMessage: string | null = null;
    try {
      const response = await fetch("/api/google-calendar/retry-failed", {
        method: "POST",
        cache: "no-store",
      });
      if (response.status === 409) {
        errorMessage = "Reconnect Google Calendar before retrying.";
      } else if (!response.ok) {
        errorMessage = "Couldn\u2019t retry. Try again.";
      } else {
        retryBody = (await response.json()) as RetryAllFailedResponse;
      }
    } catch {
      errorMessage = "Couldn\u2019t retry. Try again.";
    }

    // Even on error, refresh counts once so the UI matches the DB.
    await drainStatusUntilIdle();

    if (!isMounted.current) return;
    if (errorMessage !== null) {
      setRetryResult({ message: errorMessage, tone: "error" });
    } else if (retryBody !== null) {
      setRetryResult(formatRetryResult(retryBody));
    }
    setIsRetrying(false);
  }

  return (
    <>
      {serverRunInProgress && !isRetrying && (
        <p role="status" aria-live="polite" className="text-sm text-text-secondary">
          Syncing {totalDone} of {status.upcomingLessonCount}&hellip;
        </p>
      )}
      {status.failedLessonCount > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-danger">
            {status.failedLessonCount}{" "}
            {status.failedLessonCount === 1 ? "lesson" : "lessons"} failed to sync
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => { void handleRetry(); }}
            disabled={isRetrying}
            aria-busy={isRetrying}
          >
            {isRetrying ? "Retrying\u2026" : "Retry"}
          </Button>
        </div>
      )}
      {retryResult !== null && (
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${retryResult.tone === "success" ? "text-text-secondary" : "text-danger"}`}
        >
          {retryResult.message}
        </p>
      )}
    </>
  );
}

function formatRetryResult(body: RetryAllFailedResponse): RetryResult {
  if (body.attempted === 0) {
    return { message: "No lessons needed retrying.", tone: "success" };
  }
  if (body.failed === 0) {
    const noun = body.succeeded === 1 ? "lesson" : "lessons";
    return { message: `All ${body.succeeded} ${noun} synced.`, tone: "success" };
  }
  const noun = body.failed === 1 ? "lesson" : "lessons";
  return {
    message: `${body.failed} ${noun} still couldn\u2019t sync.`,
    tone: "error",
  };
}
