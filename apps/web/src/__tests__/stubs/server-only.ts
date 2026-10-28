// Vitest stub for the `server-only` package. The real package throws
// whenever it is loaded from a client bundle, which is the behavior we
// want in production builds (webpack catches a stray client import at
// build time). In the test runtime there is no client-vs-server
// distinction and the throw would break every test that touches a
// server module. The vitest config aliases `server-only` to this file.
export {};
