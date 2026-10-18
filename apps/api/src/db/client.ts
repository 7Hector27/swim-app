import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "../lib/env";
import * as schema from "./schema";

const pool = postgres(getEnv().databaseUrl);
export const db = drizzle(pool, { schema });
