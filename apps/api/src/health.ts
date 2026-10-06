import type { HealthResponse } from "@swim-app/shared";

export function buildHealthResponse(dbOk: boolean): HealthResponse {
  return {
    status: dbOk ? "ok" : "error",
    db: dbOk,
    timestamp: new Date().toISOString(),
  };
}
