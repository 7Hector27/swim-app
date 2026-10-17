import type { AvailabilitySeason, AvailabilityOverride } from "@swim-app/shared";
import type { availabilitySeasons, availabilityOverrides } from "../db/schema";

function toHHMM(time: string): string {
  return time.slice(0, 5);
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
