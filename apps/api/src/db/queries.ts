import { and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "./client";
import { swimmers } from "./schema";

// Single source of truth for the "active swimmer" filter.
// Every query against the swimmers table must use this to exclude archived rows.
export const isActiveSwimmer: SQL = isNull(swimmers.archivedAt);

export function activeSwimmersBase(extraWhere?: SQL, tx: typeof db = db) {
  return tx.select().from(swimmers).where(and(isActiveSwimmer, extraWhere));
}
