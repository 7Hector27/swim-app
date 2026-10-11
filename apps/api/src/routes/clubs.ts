import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { clubs } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { validate } from "../middleware/validate";
import type { Club } from "@swim-app/shared";

export const clubsRouter = Router();

clubsRouter.get("/", requireUser, validate({}), async (_req, res) => {
  const rows = await db
    .select()
    .from(clubs)
    .where(eq(clubs.isActive, true));

  const body: Club[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  res.json(body);
});
