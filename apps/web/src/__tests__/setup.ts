import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement IntersectionObserver; provide a no-op stub.
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
