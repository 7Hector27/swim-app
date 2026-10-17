import type { AvailabilityConfig, AvailabilitySeason, AvailabilityOverride } from "@swim-app/shared";
import { db } from "../db/client";
import { availabilityConfig, availabilitySeasons, availabilityOverrides } from "../db/schema";
import type { DefaultHours } from "./effectiveHours";

function toHHMM(time: string): string {
  return time.slice(0, 5);
}

export function mapConfigRow(
  row: typeof availabilityConfig.$inferSelect,
): AvailabilityConfig {
  return {
    id: row.id,
    maxDailyLessonMinutes: row.maxDailyLessonMinutes,
    bookingMinAdvanceHours: row.bookingMinAdvanceHours,
    bookingMaxAdvanceWeeks: row.bookingMaxAdvanceWeeks,
    defaultTeachesDays: row.defaultTeachesDays,
    defaultStartTime: toHHMM(row.defaultStartTime),
    defaultEndTime: toHHMM(row.defaultEndTime),
  };
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

export function mapSeasonRow(
  row: typeof availabilitySeasons.$inferSelect,
): AvailabilitySeason {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    teachesDays: row.teachesDays,
    weekdayStartTime: row.weekdayStartTime === null ? null : toHHMM(row.weekdayStartTime),
    weekendStartTime: row.weekendStartTime === null ? null : toHHMM(row.weekendStartTime),
    endTime: toHHMM(row.endTime),
    startsAtDst: row.startsAtDst,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapOverrideRow(
  row: typeof availabilityOverrides.$inferSelect,
): AvailabilityOverride {
  return {
    id: row.id,
    kind: row.kind,
    startDate: row.startDate,
    endDate: row.endDate,
    startTime: row.startTime === null ? null : toHHMM(row.startTime),
    endTime: row.endTime === null ? null : toHHMM(row.endTime),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
