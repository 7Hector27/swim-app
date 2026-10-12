import type { RequestHandler } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import type { IdParams } from '@swim-app/shared';
import { db } from '../db/client';
import { swimmers } from '../db/schema';

export const requireHouseholdSwimmer: RequestHandler = async (req, res, next) => {
  const { id: swimmerId } = req.params as unknown as IdParams;
  const rows = await db
    .select({ id: swimmers.id })
    .from(swimmers)
    .where(and(eq(swimmers.id, swimmerId), eq(swimmers.householdId, req.householdId), isNull(swimmers.archivedAt)))
    .limit(1);
  if (!rows[0]) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
};
