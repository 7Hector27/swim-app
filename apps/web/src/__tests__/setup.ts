import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Testing Library's default findBy/waitFor timeout is 1000ms. Under full-suite
// load (pnpm test running api + web + shared, jsdom + React 19 scheduler +
// mocked server actions), components routinely need longer than that to mount,
// render, resolve suspense, and settle useEffect. 3000ms is still far below
// vitest's default per-test timeout (5000ms) and keeps real latency bugs in
// range to be noticed.
configure({ asyncUtilTimeout: 3000 });

// publicEnv validates at module load, so provide placeholder values before any
// test file imports a module that touches the env schema. Tests that assert
// env-validation behavior override these in their own files.
process.env["NEXT_PUBLIC_API_URL"] ??= "http://localhost:3001";
process.env["NEXT_PUBLIC_SITE_URL"] ??= "http://localhost:3000";
process.env["NEXT_PUBLIC_SUPABASE_URL"] ??= "http://127.0.0.1:54321";
process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ??= "placeholder-anon-key";

// jsdom doesn't implement IntersectionObserver; provide a no-op stub.
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

// jsdom doesn't implement scrollIntoView either; EvaluateContent calls it from
// a useEffect after client-side validation fails, so provide a stub so unrelated
// tests can submit forms without crashing. Tests that actually assert scroll
// behavior override this on their own.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom doesn't implement matchMedia. CoachNotificationBell uses it to
// decide whether the bottom-sheet scroll-lock applies (mobile only).
// Default to no-match (desktop); tests that need to simulate the mobile
// branch override this on their own.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

// Pin the clock for every test by default so no test silently depends on the
// real wall clock. Only Date is faked so setTimeout, setInterval, and
// queueMicrotask remain real — testing-library's waitFor and React's
// scheduler keep polling with real timers. Tests that need a specific instant
// (fixture dates, DST boundaries, "today is a Tuesday") call
// vi.setSystemTime themselves; tests that need all timers faked call
// vi.useFakeTimers() with their own options and the explicit call overrides.
// Monday 10:00 LA sits inside most fixture weeks and keeps weekday-based
// tests deterministic.
const DEFAULT_FROZEN_NOW = new Date("2026-10-26T17:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DEFAULT_FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
