import type { RequestHandler } from "express";

// Match a request path against a single FAIL_ROUTES pattern. Patterns ending
// in `*` are prefix matches (the `*` is dropped and the remainder is matched
// against the start of the path). Everything else is exact.
//
//   "/clubs"      → matches only "/clubs"
//   "/lessons*"   → matches "/lessons", "/lessons/foo", "/lessons/foo/bar"
//   "/lessons/*"  → matches "/lessons/", "/lessons/foo" (but not "/lessons")
export function matchesFailPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return path === pattern;
}

// Fault-injection middleware. Returns a 500 with the standard error shape
// before the route handler runs when `req.path` matches any configured
// pattern. parseEnv already guarantees `patterns` is empty outside
// APP_ENV=local, so there is no runtime guard here.
export function failRoutes(patterns: readonly string[]): RequestHandler {
  if (patterns.length === 0) {
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    for (const pattern of patterns) {
      if (matchesFailPattern(req.path, pattern)) {
        req.log.warn(
          { path: req.path, pattern },
          "FAIL_ROUTES fault injection: returning 500",
        );
        res.status(500).json({ error: "Internal server error" });
        return;
      }
    }
    next();
  };
}
