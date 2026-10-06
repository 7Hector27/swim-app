import "dotenv/config";
import express from "express";
import { db } from "./db/client";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@swim-app/shared";

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // db unreachable — still return 200 with status details
  }

  const body: HealthResponse = {
    status: dbOk ? "ok" : "error",
    db: dbOk,
    timestamp: new Date().toISOString(),
  };

  res.status(dbOk ? 200 : 503).json(body);
});

const port = process.env.PORT ?? 3001;
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
