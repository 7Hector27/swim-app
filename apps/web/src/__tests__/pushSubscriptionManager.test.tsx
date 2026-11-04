import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the API client so we don't hit fetch during tests. Each test may
// override the mocks.
const { mockFetchSubs, mockRegister, mockDelete, mockTest } = vi.hoisted(() => ({
  mockFetchSubs: vi.fn(),
  mockRegister: vi.fn(),
  mockDelete: vi.fn(),
  mockTest: vi.fn(),
}));

vi.mock("@/lib/api/coachAlerts", () => ({
  fetchPushSubscriptions: mockFetchSubs,
  registerPushSubscription: mockRegister,
  deletePushSubscription: mockDelete,
  sendTestPush: mockTest,
}));

import PushSubscriptionManager from "../content/AccountContent/NotificationsSection/PushSubscriptionManager";

// Non-empty VAPID key so the enable branch can run. Shape matches a
// base64url string; the push transport is mocked anyway.
const VAPID = "AAAA";

const originalNavigator = globalThis.navigator;
const originalNotification = (globalThis as unknown as { Notification?: unknown }).Notification;

function stubNavigator(overrides: Partial<Navigator> = {}) {
  Object.defineProperty(globalThis, "navigator", {
    value: { ...originalNavigator, ...overrides },
    configurable: true,
  });
}

function stubWindow(permission: NotificationPermission | undefined, hasPushManager: boolean) {
  if (permission === undefined) {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  } else {
    (globalThis as unknown as { Notification: { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> } }).Notification = {
      permission,
      requestPermission: vi.fn().mockResolvedValue("granted"),
    };
  }
  if (hasPushManager) {
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
  } else {
    delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSubs.mockResolvedValue({ ok: true, data: { items: [] } });
});

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
  if (originalNotification !== undefined) {
    (globalThis as unknown as { Notification: unknown }).Notification = originalNotification;
  } else {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  }
});

describe("PushSubscriptionManager", () => {
  it("renders the unsupported message when the browser lacks service workers", async () => {
    stubNavigator({});
    stubWindow(undefined, false);
    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);
    await waitFor(() => {
      expect(screen.getByText(/does not support notifications/i)).toBeInTheDocument();
    });
  });

  it("shows the enable button when permission is default", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    stubWindow("default", true);

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /turn on notifications/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows the devices list when permission is granted", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0",
    });
    stubWindow("granted", true);
    mockFetchSubs.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: "sub-1",
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
            createdAt: "2026-10-20T10:00:00Z",
            lastDeliveryAt: null,
          },
        ],
      },
    });

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);
    await waitFor(() => {
      expect(screen.getByText(/chrome on macos/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /send test notification/i })).toBeEnabled();
  });

  it("shows the blocked message when permission is denied", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    stubWindow("denied", true);

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);
    await waitFor(() => {
      expect(screen.getByText(/notifications are blocked/i)).toBeInTheDocument();
    });
  });

  it("shows iPhone install steps on iOS Safari without home-screen install", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/604.1",
    });
    stubWindow("default", true);
    // Ensure matchMedia returns false for display-mode: standalone.
    window.matchMedia = ((query: string) => ({
      matches: !query.includes("standalone"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as (query: string) => MediaQueryList;

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);
    await waitFor(() => {
      expect(screen.getByText(/add this app to your home screen/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/share icon/i)).toBeInTheDocument();
  });

  it("removes a device and refreshes the list", async () => {
    stubNavigator({
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
      } as unknown as ServiceWorkerContainer,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    });
    stubWindow("granted", true);
    mockFetchSubs
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [
            {
              id: "sub-1",
              userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
              createdAt: "2026-10-20T10:00:00Z",
              lastDeliveryAt: null,
            },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { items: [] } });
    mockDelete.mockResolvedValue({ ok: true, status: 204 });

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);
    await waitFor(() => expect(screen.getByText(/chrome on windows/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("sub-1"));
    await waitFor(() =>
      expect(screen.getByText(/notifications are off on this account/i)).toBeInTheDocument(),
    );
  });

  it("renders without crashing when the VAPID key prop is undefined", async () => {
    // Regression: the component used to import publicEnv at module load,
    // which crashed in the browser because dynamic process.env lookups are
    // not inlined. With the key as a prop, missing-key is a quiet degraded
    // state — the Enable button appears but surfaces an error on click.
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    stubWindow("default", true);
    render(<PushSubscriptionManager vapidPublicKey={undefined} />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /turn on notifications/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /turn on notifications/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/push is not configured on this environment/i),
      ).toBeInTheDocument(),
    );
  });

  // The audit's bug: a failed /coach/push/subscriptions fetch used to leave
  // subscriptions=[] and loadingList=false, so the UI showed "Notifications
  // are off on this account" — identical to a legitimately unsubscribed
  // account. Now the failure flips a `listError` flag that renders InlineError
  // with retry instead, so a coach never thinks their alerts are silently off.
  it("shows an error with retry (not 'Notifications are off') when refresh fails after permission is granted", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    stubWindow("granted", true);
    mockFetchSubs.mockResolvedValueOnce({ ok: false, status: 500 });

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load your devices/i);
    expect(
      screen.queryByText(/Notifications are off on this account/i),
    ).toBeNull();
    const retry = screen.getByRole("button", { name: /try again/i });
    expect(retry).toBeInTheDocument();
  });

  it("retry button re-runs the fetch and renders the devices list on success", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    stubWindow("granted", true);
    // First load fails; the retry call succeeds with one device.
    mockFetchSubs
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [
            {
              id: "sub-1",
              userAgent: "Mozilla/5.0 (Windows NT 10.0)",
              createdAt: "2026-06-01T00:00:00.000Z",
              lastDeliveryAt: null,
            },
          ],
        },
      });

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);

    const retry = await screen.findByRole("button", { name: /try again/i });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    // Device row rendered from the second fetch.
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeInTheDocument();
  });

  it("empty (but ok) response renders 'Notifications are off', not an error", async () => {
    stubNavigator({
      serviceWorker: {} as unknown as ServiceWorkerContainer,
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    });
    stubWindow("granted", true);
    mockFetchSubs.mockResolvedValue({ ok: true, data: { items: [] } });

    render(<PushSubscriptionManager vapidPublicKey={VAPID} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Notifications are off on this account/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
