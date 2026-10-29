import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { GoogleCalendarStatusResponse, RetryAllFailedResponse } from "@swim-app/shared";

import SyncingState from "../content/AccountContent/GoogleCalendarCard/SyncingState";

// SyncingState drives everything through two endpoints:
//   POST /api/google-calendar/retry-failed → RetryAllFailedResponse
//   GET  /api/google-calendar/status       → GoogleCalendarStatusResponse
// Mock global.fetch and route by url + method.

const mockFetch = vi.fn();

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
function okJson(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function initialStatus(partial: Partial<GoogleCalendarStatusResponse> = {}): GoogleCalendarStatusResponse {
  return {
    status: "active",
    connectedAccountEmail: "coach@example.com",
    connectedAt: "2026-10-01T00:00:00.000Z",
    googleCalendarId: "cal-id",
    lastSyncAttemptedAt: null,
    lastSyncSucceededAt: null,
    needsReconnectSince: null,
    upcomingLessonCount: 3,
    syncedCount: 1,
    pendingSyncCount: 0,
    failedLessonCount: 2,
    syncRunInProgress: false,
    ...partial,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncingState Retry — pending state", () => {
  it("shows a disabled 'Retrying…' button from the moment the user clicks until the fetch resolves", async () => {
    // Hold the retry fetch in flight so we can observe the pending UI.
    let resolveRetry: (value: FakeResponse) => void = () => {};
    const retryPromise = new Promise<FakeResponse>((resolve) => {
      resolveRetry = resolve;
    });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/google-calendar/retry-failed") && init?.method === "POST") {
        return retryPromise;
      }
      if (url.includes("/api/google-calendar/status")) {
        return Promise.resolve(okJson(initialStatus()));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);

    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    const pendingButton = await screen.findByRole("button", { name: /Retrying/ });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    // No result yet while in flight.
    expect(screen.queryByText(/synced\.$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/still couldn/)).not.toBeInTheDocument();

    // Resolve so the pending state can clear and we leave a clean promise chain.
    const retryBody: RetryAllFailedResponse = { attempted: 2, succeeded: 2, failed: 0 };
    await act(async () => {
      resolveRetry(okJson(retryBody));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).not.toBeDisabled();
    });
  });
});

describe("SyncingState Retry — instant success", () => {
  it("shows 'All lessons synced' when the retry resolves with no failures and syncRunInProgress is false", async () => {
    const retryBody: RetryAllFailedResponse = { attempted: 2, succeeded: 2, failed: 0 };
    // After the retry, the status call reports counts and no run in progress.
    const afterStatus = initialStatus({ failedLessonCount: 0, syncedCount: 3, syncRunInProgress: false });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/retry-failed") && init?.method === "POST") {
        return Promise.resolve(okJson(retryBody));
      }
      if (url.includes("/status")) {
        return Promise.resolve(okJson(afterStatus));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    const result = await screen.findByText("All 2 lessons synced.");
    expect(result).toBeInTheDocument();
    // Button returns to the idle label — but with failedLessonCount now 0,
    // the entire failed row disappears instead. Assert the pending label is gone.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Retrying/ })).not.toBeInTheDocument();
    });
  });

  it("shows '1 lesson synced.' (singular, no 'All') when only one lesson was retried", async () => {
    const retryBody: RetryAllFailedResponse = { attempted: 1, succeeded: 1, failed: 0 };
    const afterStatus = initialStatus({ failedLessonCount: 0, syncedCount: 1, syncRunInProgress: false });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/retry-failed") && init?.method === "POST") {
        return Promise.resolve(okJson(retryBody));
      }
      if (url.includes("/status")) {
        return Promise.resolve(okJson(afterStatus));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("1 lesson synced.")).toBeInTheDocument();
  });

  it("shows 'N still couldn't sync' when some lessons remained failed after retry", async () => {
    const retryBody: RetryAllFailedResponse = { attempted: 3, succeeded: 1, failed: 2 };
    const afterStatus = initialStatus({ failedLessonCount: 2, syncedCount: 1, syncRunInProgress: false });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/retry-failed") && init?.method === "POST") {
        return Promise.resolve(okJson(retryBody));
      }
      if (url.includes("/status")) {
        return Promise.resolve(okJson(afterStatus));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("2 lessons still couldn\u2019t sync.")).toBeInTheDocument();
  });
});

describe("SyncingState Retry — poll until run finishes", () => {
  it("holds the pending state and shows the result only after status reports syncRunInProgress=false", async () => {
    // The global setup pins Date via useFakeTimers({ toFake: ["Date"] }), so
    // reset to real first — a second useFakeTimers call while fake-Date is
    // already active doesn't re-apply the default setTimeout faking that
    // advanceTimersByTimeAsync depends on.
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const retryBody: RetryAllFailedResponse = { attempted: 2, succeeded: 2, failed: 0 };
    // First status call after retry: still in progress.
    // Second status call: done.
    let statusCallCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/retry-failed") && init?.method === "POST") {
        return Promise.resolve(okJson(retryBody));
      }
      if (url.includes("/status")) {
        statusCallCount++;
        if (statusCallCount === 1) {
          return Promise.resolve(
            okJson(initialStatus({ syncRunInProgress: true, syncedCount: 2, failedLessonCount: 1 })),
          );
        }
        return Promise.resolve(
          okJson(initialStatus({ syncRunInProgress: false, syncedCount: 3, failedLessonCount: 0 })),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    // After the retry response arrives but syncRunInProgress is still true,
    // we remain in the pending state (no result yet).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Retrying/ })).toBeDisabled();
    });
    expect(screen.queryByText(/synced\.$/)).not.toBeInTheDocument();

    // Advance timers past the 1s drain interval so the second status call fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    // Second status call reports done → result appears, pending clears.
    expect(await screen.findByText("All 2 lessons synced.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Retrying/ })).not.toBeInTheDocument();
    });
  });
});

describe("SyncingState Retry — error surfacing", () => {
  it("surfaces a 409 (needs reconnect) as a friendly message", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/retry-failed") && init?.method === "POST") {
        return Promise.resolve(okJson({ error: "Reconnection required" }, 409));
      }
      if (url.includes("/status")) {
        return Promise.resolve(okJson(initialStatus()));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("Reconnect Google Calendar before retrying."),
    ).toBeInTheDocument();
  });

  it("surfaces a thrown fetch as a generic retry-again message", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/retry-failed") && init?.method === "POST") {
        return Promise.reject(new Error("network"));
      }
      if (url.includes("/status")) {
        return Promise.resolve(okJson(initialStatus()));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<SyncingState initial={initialStatus()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Couldn\u2019t retry. Try again.")).toBeInTheDocument();
  });
});
