import "@testing-library/jest-dom/vitest";

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
