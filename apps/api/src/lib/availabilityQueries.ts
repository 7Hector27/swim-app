import { db } from "../db/client";
import { availabilityConfig } from "../db/schema";
import type { DefaultHours } from "./effectiveHours";

function toHHMM(time: string): string {
  return time.slice(0, 5);
}

export async function fetchAvailabilityDefaults(): Promise<DefaultHours | null> {
  const rows = await db.select().from(availabilityConfig).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    defaultTeachesDays: row.defaultTeachesDays,
    defaultStartTime: toHHMM(row.defaultStartTime),
    defaultEndTime: toHHMM(row.defaultEndTime),
  };
}
