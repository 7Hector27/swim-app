// Shared discriminated result for data loads shared between server pages and
// client fetch helpers. The error branch distinguishes network/server/schema so
// callers can decide whether a retry CTA makes sense without needing an HTTP
// status code at the UI layer.
export type LoadErrorReason = "network" | "server" | "schema";

export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: LoadErrorReason };

export function loadOk<T>(data: T): LoadResult<T> {
  return { ok: true, data };
}

export function loadError<T>(reason: LoadErrorReason): LoadResult<T> {
  return { ok: false, reason };
}
