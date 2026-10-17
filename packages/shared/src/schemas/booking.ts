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
  maxDailyLessonMinutes: z.number().int(),
  bookingMinAdvanceHours: z.number().int(),
  bookingMaxAdvanceWeeks: z.number().int(),
});
export type AvailabilityConfig = z.infer<typeof AvailabilityConfigSchema>;

export const PatchAvailabilityConfigBodySchema = z.object({
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

// ── Upcoming lessons (parent-facing) ─────────────────────────────────────────

export const UpcomingLessonsQuerySchema = z.object({
  after: z.string().datetime({ offset: true }).optional(),
  limit: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(z.number().int().min(1).max(50))
    .optional(),
  filter: z.enum(["upcoming", "past"]).optional(),
});
export type UpcomingLessonsQuery = z.infer<typeof UpcomingLessonsQuerySchema>;

export const UpcomingLessonSchema = LessonResponseSchema.omit({ householdId: true }).extend({
  locationName: z.string(),
});
export type UpcomingLesson = z.infer<typeof UpcomingLessonSchema>;

// ── Coach schedule ────────────────────────────────────────────────────────────

export const CoachScheduleQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CoachScheduleQuery = z.infer<typeof CoachScheduleQuerySchema>;

export const ScheduleLessonItemSchema = z.object({
  type: z.literal("lesson"),
  lesson: LessonResponseSchema,
  locationName: z.string(),
});
export type ScheduleLessonItem = z.infer<typeof ScheduleLessonItemSchema>;

export const ScheduleTravelBufferItemSchema = z.object({
  type: z.literal("travel_buffer"),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  fromLocationName: z.string(),
  toLocationName: z.string(),
});
export type ScheduleTravelBufferItem = z.infer<typeof ScheduleTravelBufferItemSchema>;

export const ScheduleOpenSlotItemSchema = z.object({
  type: z.literal("open_slot"),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
});
export type ScheduleOpenSlotItem = z.infer<typeof ScheduleOpenSlotItemSchema>;

export const ScheduleItemSchema = z.discriminatedUnion("type", [
  ScheduleLessonItemSchema,
  ScheduleTravelBufferItemSchema,
  ScheduleOpenSlotItemSchema,
]);
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;

// ── Coach stats ───────────────────────────────────────────────────────────────

export const CoachStatsSchema = z.object({
  lessonsToday: z.number().int(),
  lessonsThisWeek: z.number().int(),
  pendingRequests: z.number().int(),
  activeSwimmers: z.number().int(),
  calendarSyncFailures: z.number().int(),
});
export type CoachStats = z.infer<typeof CoachStatsSchema>;

// ── Availability seasons ──────────────────────────────────────────────────────

const TimeStringSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const AvailabilitySeasonSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teachesDays: z.array(z.number().int().min(1).max(7)),
  weekdayStartTime: TimeStringSchema.nullable(),
  weekendStartTime: TimeStringSchema.nullable(),
  endTime: TimeStringSchema,
  startsAtDst: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AvailabilitySeason = z.infer<typeof AvailabilitySeasonSchema>;

// ── Availability overrides ────────────────────────────────────────────────────

export const AvailabilityOverrideKindSchema = z.enum(["day_off", "custom_hours"]);
export type AvailabilityOverrideKind = z.infer<typeof AvailabilityOverrideKindSchema>;

export const AvailabilityOverrideSchema = z.object({
  id: z.string().uuid(),
  kind: AvailabilityOverrideKindSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: TimeStringSchema.nullable(),
  endTime: TimeStringSchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AvailabilityOverride = z.infer<typeof AvailabilityOverrideSchema>;

// ── Update lesson (cancel / reschedule) ──────────────────────────────────────

export const UpdateLessonBodySchema = z.object({
  startsAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]).optional(),
  locationId: z.string().uuid().optional(),
});
export type UpdateLessonBody = z.infer<typeof UpdateLessonBodySchema>;

// ── Booking calendar availability ─────────────────────────────────────────────

export const SlotStateSchema = z.enum([
  "available",
  "unavailable",
  "too_soon",
  "past",
  "not_open_yet",
]);
export type SlotState = z.infer<typeof SlotStateSchema>;

export const DayStateSchema = z.enum([
  "open",
  "closed",
  "past",
  "not_open_yet",
]);
export type DayState = z.infer<typeof DayStateSchema>;

export const SlotWithStateSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  state: SlotStateSchema,
});
export type SlotWithState = z.infer<typeof SlotWithStateSchema>;

export const TeachingWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/),
});
export type TeachingWindow = z.infer<typeof TeachingWindowSchema>;

export const DayAvailabilitySchema = z.object({
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayState:        DayStateSchema,
  openCount:       z.number().int(),
  totalCount:      z.number().int(),
  teachingWindows: z.array(TeachingWindowSchema),
});
export type DayAvailability = z.infer<typeof DayAvailabilitySchema>;

export const WeekDayAvailabilitySchema = DayAvailabilitySchema.extend({
  slots: z.array(SlotWithStateSchema),
});
export type WeekDayAvailability = z.infer<typeof WeekDayAvailabilitySchema>;

export const RangeAvailabilityQuerySchema = z.object({
  view:            z.enum(["week", "month"]),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(z.union([z.literal(30), z.literal(45), z.literal(60)])),
  locationId:      z.string().uuid(),
  excludeLessonId: z.string().uuid().optional(),
});
export type RangeAvailabilityQuery = z.infer<typeof RangeAvailabilityQuerySchema>;

export const MonthAvailabilityResponseSchema = z.object({
  needsApproval: z.boolean(),
  days:          z.array(DayAvailabilitySchema),
});
export type MonthAvailabilityResponse = z.infer<typeof MonthAvailabilityResponseSchema>;

export const WeekAvailabilityResponseSchema = z.object({
  needsApproval: z.boolean(),
  days:          z.array(WeekDayAvailabilitySchema),
});
export type WeekAvailabilityResponse = z.infer<typeof WeekAvailabilityResponseSchema>;
