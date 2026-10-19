import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbEnv } from "../lib/env";
import * as schema from "./schema";

const pool = postgres(getDbEnv().databaseUrl);
export const db = drizzle(pool, { schema });
