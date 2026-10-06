// Shared types across web and api.
// Add domain types here as features are built.

export type HealthResponse = {
  status: "ok" | "error";
  db: boolean;
  timestamp: string;
};
