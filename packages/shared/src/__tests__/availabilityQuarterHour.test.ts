import { describe, expect, it } from "vitest";

import {
  CreateOverrideBodySchema,
  CreateSeasonBodySchema,
  PatchAvailabilityConfigBodySchema,
  PatchOverrideBodySchema,
  PatchSeasonBodySchema,
} from "../schemas/booking";

const validSeason = {
  name: "Spring 2027",
  startDate: "2027-03-01",
  endDate: "2027-05-31",
  teachesDays: [1, 2, 3, 4, 5],
  weekdayStartTime: "16:00" as string | null,
  weekdayEndTime: "19:00" as string | null,
  weekendStartTime: null,
  weekendEndTime: null,
};

const validCustomHoursOverride = {
  kind: "custom_hours" as const,
  startDate: "2027-04-01",
  endDate: "2027-04-01",
  startTime: "08:00",
  endTime: "10:00",
};

describe("quarter-hour enforcement on availability schemas", () => {
  it("CreateSeasonBodySchema rejects an off-boundary weekday start time (04:43)", () => {
    const result = CreateSeasonBodySchema.safeParse({
      ...validSeason,
      weekdayStartTime: "04:43",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((entry) =>
        entry.path.includes("weekdayStartTime"),
      );
      expect(issue?.message).toMatch(/15-minute step/);
    }
  });

  it("CreateSeasonBodySchema accepts quarter-hour weekday times", () => {
    const result = CreateSeasonBodySchema.safeParse({
      ...validSeason,
      weekdayStartTime: "16:15",
      weekdayEndTime: "19:45",
    });
    expect(result.success).toBe(true);
  });

  it("PatchSeasonBodySchema rejects an off-boundary weekend end time", () => {
    const result = PatchSeasonBodySchema.safeParse({
      weekendEndTime: "20:07",
    });
    expect(result.success).toBe(false);
  });

  it("CreateOverrideBodySchema rejects 4:43 PM on a custom-hours override", () => {
    const result = CreateOverrideBodySchema.safeParse({
      ...validCustomHoursOverride,
      startTime: "16:43",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((entry) =>
        entry.path.includes("startTime"),
      );
      expect(issue?.message).toMatch(/15-minute step/);
    }
  });

  it("PatchOverrideBodySchema accepts a quarter-hour end time", () => {
    const result = PatchOverrideBodySchema.safeParse({
      endTime: "17:30",
    });
    expect(result.success).toBe(true);
  });

  it("PatchAvailabilityConfigBodySchema still rejects 4:43 on default hours", () => {
    const result = PatchAvailabilityConfigBodySchema.safeParse({
      defaultStartTime: "04:43",
    });
    expect(result.success).toBe(false);
  });
});
