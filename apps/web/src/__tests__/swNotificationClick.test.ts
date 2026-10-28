import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";

// Load apps/web/public/sw.js in a stubbed scope so we can assert the
// notificationclick listener behaves correctly. Pure JS, no bundler
// transforms — simpler than mocking the whole SW global object inside
// jsdom.

interface SwScope {
  listeners: Map<string, (event: unknown) => void>;
  openWindowCalls: string[];
  focusedUrls: string[];
  navigatedUrls: string[];
  clientWindows: Array<{ url: string; focus: () => void; navigate: (url: string) => Promise<void> }>;
  showNotificationCalls: Array<{ title: string; options: Record<string, unknown> }>;
}

function createSwScope(): SwScope {
  const state: SwScope = {
    listeners: new Map(),
    openWindowCalls: [],
    focusedUrls: [],
    navigatedUrls: [],
    clientWindows: [],
    showNotificationCalls: [],
  };

  const self = {
    location: { origin: "http://localhost:3000" },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        state.showNotificationCalls.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: async () => state.clientWindows,
      openWindow: async (url: string) => {
        state.openWindowCalls.push(url);
        return null;
      },
    },
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      state.listeners.set(name, handler);
    },
  };

  const code = readFileSync(
    path.resolve(__dirname, "../../public/sw.js"),
    "utf8",
  );
  const context = vm.createContext({
    self,
    caches: {
      open: async () => ({ match: async () => null }),
    },
    atob,
    fetch: () => Promise.resolve({ ok: true }),
    URL,
    Uint8Array,
  });
  vm.runInContext(code, context);
  return state;
}

function fireNotificationClick(scope: SwScope, clickUrl: string | null) {
  const handler = scope.listeners.get("notificationclick");
  if (!handler) throw new Error("notificationclick handler not registered");
  let waitUntilPromise: Promise<unknown> | undefined;
  const event = {
    notification: {
      close: vi.fn(),
      data: clickUrl !== null ? { click_url: clickUrl } : undefined,
    },
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilPromise = promise;
    },
  };
  handler(event);
  return { event, waitUntilPromise };
}

describe("service worker — notificationclick", () => {
  let scope: SwScope;
  beforeEach(() => {
    scope = createSwScope();
  });

  it("opens a new window when no existing client matches", async () => {
    const { waitUntilPromise } = fireNotificationClick(scope, "/coach/lessons/l1");
    await waitUntilPromise;
    expect(scope.openWindowCalls).toEqual(["http://localhost:3000/coach/lessons/l1"]);
  });

  it("focuses an existing client with the same URL instead of opening a new window", async () => {
    scope.clientWindows = [
      {
        url: "http://localhost:3000/coach/lessons/l1",
        focus: () => scope.focusedUrls.push("http://localhost:3000/coach/lessons/l1"),
        navigate: async () => {},
      },
    ];
    const { waitUntilPromise } = fireNotificationClick(scope, "/coach/lessons/l1");
    await waitUntilPromise;
    expect(scope.focusedUrls).toEqual(["http://localhost:3000/coach/lessons/l1"]);
    expect(scope.openWindowCalls).toEqual([]);
  });

  it("navigates a same-origin client to the target URL when the URLs differ", async () => {
    scope.clientWindows = [
      {
        url: "http://localhost:3000/dashboard",
        focus: () => scope.focusedUrls.push("http://localhost:3000/dashboard"),
        navigate: async (url) => {
          scope.navigatedUrls.push(url);
        },
      },
    ];
    const { waitUntilPromise } = fireNotificationClick(scope, "/coach/lessons/l1");
    await waitUntilPromise;
    expect(scope.navigatedUrls).toEqual(["http://localhost:3000/coach/lessons/l1"]);
    expect(scope.focusedUrls).toEqual(["http://localhost:3000/dashboard"]);
  });

  it("falls back to the site root when the click URL is missing", async () => {
    const { waitUntilPromise } = fireNotificationClick(scope, null);
    await waitUntilPromise;
    expect(scope.openWindowCalls).toEqual(["http://localhost:3000/"]);
  });
});

describe("service worker — push", () => {
  it("renders the showNotification call from the JSON payload", async () => {
    const scope = createSwScope();
    const handler = scope.listeners.get("push");
    if (!handler) throw new Error("push handler not registered");
    const event = {
      data: {
        json: () => ({
          title: "New booking request",
          body: "Alex R., Tue 4:30 PM at Egret Park",
          tag: "lesson:l1",
          click_url: "/coach/lessons/l1",
          urgency: "urgent",
        }),
      },
      waitUntil: (p: Promise<unknown>) => p,
    };
    handler(event);
    await Promise.resolve();
    expect(scope.showNotificationCalls).toHaveLength(1);
    const call = scope.showNotificationCalls[0]!;
    expect(call.title).toBe("New booking request");
    expect(call.options.tag).toBe("lesson:l1");
    expect(call.options.requireInteraction).toBe(true);
    expect((call.options.data as { click_url: string }).click_url).toBe(
      "/coach/lessons/l1",
    );
  });
});
