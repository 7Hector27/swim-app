import "dotenv/config";
import express from "express";
import { db } from "./db/client";
import { sql } from "drizzle-orm";
import { buildHealthResponse } from "./health";

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (err) {
    console.error("DB health check failed:", err);
  }

  const body = buildHealthResponse(dbOk);
  res.status(dbOk ? 200 : 503).json(body);
});

const port = process.env.PORT ?? 3001;
app.listen(port, () =>
  console.log(`API listening on http://localhost:${port}`),
);
