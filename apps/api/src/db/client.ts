import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbEnv } from "../lib/env";
import * as schema from "./schema";

// max=10: fits Supabase's per-pool connection budget for a single API
// instance. idle_timeout=30: close idle conns after 30s so a quiet night
// doesn't hold them against Supabase's cap. connect_timeout=10: a stuck
// DB surfaces as a 500 in ~10s instead of hanging the Node default.
export const pool = postgres(getDbEnv().databaseUrl, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});
export const db = drizzle(pool, { schema });
