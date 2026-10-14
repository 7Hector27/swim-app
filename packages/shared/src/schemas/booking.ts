import { z } from "zod";

// ── Lesson location ───────────────────────────────────────────────────────────

export const LessonLocationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  isHomePool: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type LessonLocation = z.infer<typeof LessonLocationSchema>;

export const SetHomePoolBodySchema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2),
  zip: z.string().min(1),
});
export type SetHomePoolBody = z.infer<typeof SetHomePoolBodySchema>;

export const CreateLocationBodySchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1).max(2).default("CA"),
  zip: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export type CreateLocationBody = z.infer<typeof CreateLocationBodySchema>;

export const PatchLocationBodySchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).max(2).optional(),
  zip: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type PatchLocationBody = z.infer<typeof PatchLocationBodySchema>;

// ── Availability config ───────────────────────────────────────────────────────

export const AvailabilityConfigSchema = z.object({
  id: z.string().uuid(),
  lessonDays: z.array(z.number().int().min(1).max(7)),
  schoolYearStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  schoolYearEndTime: z.string().regex(/^\d{2}:\d{2}$/),
  summerMorningStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  summerMorningEndTime: z.string().regex(/^\d{2}:\d{2}$/),
  summerEveningStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  summerEveningEndTime: z.string().regex(/^\d{2}:\d{2}$/),
  maxDailyLessonMinutes: z.number().int(),
  bookingMinAdvanceHours: z.number().int(),
  bookingMaxAdvanceWeeks: z.number().int(),
});
export type AvailabilityConfig = z.infer<typeof AvailabilityConfigSchema>;

export const PatchAvailabilityConfigBodySchema = z.object({
  lessonDays: z.array(z.number().int().min(1).max(5)).min(1).optional(),
  schoolYearStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  schoolYearEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  summerMorningStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  summerMorningEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  summerEveningStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  summerEveningEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxDailyLessonMinutes: z.number().int().min(1).optional(),
  bookingMinAdvanceHours: z.number().int().min(1).optional(),
  bookingMaxAdvanceWeeks: z.number().int().min(1).optional(),
});
export type PatchAvailabilityConfigBody = z.infer<typeof PatchAvailabilityConfigBodySchema>;

// ── Blocked times ─────────────────────────────────────────────────────────────

export const BlockedTimeSchema = z.object({
  id: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  note: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type BlockedTime = z.infer<typeof BlockedTimeSchema>;

export const CreateBlockedTimeBodySchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  note: z.string().optional(),
});
export type CreateBlockedTimeBody = z.infer<typeof CreateBlockedTimeBodySchema>;

// ── Travel buffer overrides ───────────────────────────────────────────────────

export const TravelBufferOverrideSchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  bufferMinutes: z.number().int().min(0),
});
export type TravelBufferOverride = z.infer<typeof TravelBufferOverrideSchema>;

export const UpsertTravelBufferBodySchema = z.object({
  bufferMinutes: z.number().int().min(0).max(60),
});
export type UpsertTravelBufferBody = z.infer<typeof UpsertTravelBufferBodySchema>;

// ── Lessons ───────────────────────────────────────────────────────────────────

export const LessonStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
  "expired",
  "canceled",
  "no_show",
  "completed",
]);
export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const LessonTypeSchema = z.enum(["private", "family"]);
export type LessonType = z.infer<typeof LessonTypeSchema>;

export const CreateLessonBodySchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  locationId: z.string().uuid(),
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
});
export type CreateLessonBody = z.infer<typeof CreateLessonBodySchema>;

export const AvailableSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(z.union([z.literal(30), z.literal(45), z.literal(60)])),
  locationId: z.string().uuid(),
});
export type AvailableSlotsQuery = z.infer<typeof AvailableSlotsQuerySchema>;

export const LessonSwimmerSchema = z.object({
  swimmerId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
});
export type LessonSwimmer = z.infer<typeof LessonSwimmerSchema>;

export const LessonResponseSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  locationId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  type: LessonTypeSchema,
  status: LessonStatusSchema,
  swimmers: z.array(LessonSwimmerSchema),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  approvedAt: z.string().datetime({ offset: true }).nullable(),
  declinedAt: z.string().datetime({ offset: true }).nullable(),
  declineReason: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type LessonResponse = z.infer<typeof LessonResponseSchema>;

export const ApproveLessonBodySchema = z.object({});
export type ApproveLessonBody = z.infer<typeof ApproveLessonBodySchema>;

export const DeclineLessonBodySchema = z.object({
  reason: z.string().optional(),
});
export type DeclineLessonBody = z.infer<typeof DeclineLessonBodySchema>;

export const CoachListLessonsQuerySchema = z.object({
  status: LessonStatusSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  householdId: z.string().uuid().optional(),
});
export type CoachListLessonsQuery = z.infer<typeof CoachListLessonsQuerySchema>;

export const AvailableSlotSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});
export type AvailableSlot = z.infer<typeof AvailableSlotSchema>;

// ── Season summer end dates ───────────────────────────────────────────────────

export const SeasonSummerEndDateSchema = z.object({
  year: z.number().int(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SeasonSummerEndDate = z.infer<typeof SeasonSummerEndDateSchema>;

export const SetSeasonEndDateBodySchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SetSeasonEndDateBody = z.infer<typeof SetSeasonEndDateBodySchema>;
