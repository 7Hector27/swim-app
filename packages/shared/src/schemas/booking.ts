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

const QuarterHourTimeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .refine(
    (value) => {
      const parts = value.split(":");
      const minutes = parts[1];
      if (minutes === undefined) return false;
      return minutes === "00" || minutes === "15" || minutes === "30" || minutes === "45";
    },
    { message: "Time must be on a 15-minute step." },
  );

export const AvailabilityConfigSchema = z.object({
  id: z.string().uuid(),
  maxDailyLessonMinutes: z.number().int(),
  bookingMinAdvanceHours: z.number().int(),
  bookingMaxAdvanceWeeks: z.number().int(),
  // Default teaching hours used when no season covers the date and no override applies.
  defaultTeachesDays: z.array(z.number().int().min(1).max(7)),
  defaultStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  defaultEndTime: z.string().regex(/^\d{2}:\d{2}$/),
});
export type AvailabilityConfig = z.infer<typeof AvailabilityConfigSchema>;

export const PatchAvailabilityConfigBodySchema = z
  .object({
    maxDailyLessonMinutes: z.number().int().min(1).optional(),
    bookingMinAdvanceHours: z.number().int().min(1).optional(),
    bookingMaxAdvanceWeeks: z.number().int().min(1).optional(),
    defaultTeachesDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    defaultStartTime: QuarterHourTimeStringSchema.optional(),
    defaultEndTime: QuarterHourTimeStringSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.defaultStartTime !== undefined && data.defaultEndTime !== undefined) {
      if (data.defaultStartTime >= data.defaultEndTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["defaultEndTime"],
          message: "End time must be after start time.",
        });
      }
    }
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

// Shared lesson duration schema. Every lesson body/response/query that
// carries a duration imports this instead of inlining the union — keeps the
// three valid values in one place.
export const LESSON_DURATION_MINUTES = [30, 45, 60] as const;
export const LessonDurationMinutesSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(60),
]);
export type LessonDurationMinutes = z.infer<typeof LessonDurationMinutesSchema>;

export const CreateLessonBodySchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  locationId: z.string().uuid(),
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
});
export type CreateLessonBody = z.infer<typeof CreateLessonBodySchema>;

export const AvailableSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(LessonDurationMinutesSchema),
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
  durationMinutes: LessonDurationMinutesSchema,
  type: LessonTypeSchema,
  status: LessonStatusSchema,
  swimmers: z.array(LessonSwimmerSchema),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  approvedAt: z.string().datetime({ offset: true }).nullable(),
  declinedAt: z.string().datetime({ offset: true }).nullable(),
  declineReason: z.string().nullable(),
  movedAt: z.string().datetime({ offset: true }).nullable(),
  previousStartsAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type LessonResponse = z.infer<typeof LessonResponseSchema>;

export const ApproveLessonBodySchema = z.object({});
export type ApproveLessonBody = z.infer<typeof ApproveLessonBodySchema>;

// Max length for a coach-entered decline reason. Enforced at the API
// boundary (request validation) AND at the outbox-write layer, so a
// future caller that bypasses the schema can't park an unbounded blob of
// text in lesson_email_outbox.payload.declineReason. 500 characters is
// generous for a short note while bounding incidental PII (names,
// contact info a coach might type) that would otherwise persist for the
// 30-day retention window.
export const DECLINE_REASON_MAX_LENGTH = 500;

export const DeclineLessonBodySchema = z.object({
  reason: z.string().max(DECLINE_REASON_MAX_LENGTH).optional(),
});
export type DeclineLessonBody = z.infer<typeof DeclineLessonBodySchema>;

export const CalendarSyncStatusSchema = z.enum(["not_synced", "synced", "sync_failed"]);
export type CalendarSyncStatus = z.infer<typeof CalendarSyncStatusSchema>;

export const CoachListLessonsQuerySchema = z.object({
  status: LessonStatusSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  householdId: z.string().uuid().optional(),
  // Filter by Google Calendar sync state. Added for the "N lessons failed to
  // sync" chip on the coach account card (ADR 027). Does not change the
  // existing shape of a lesson response.
  calendarSyncStatus: CalendarSyncStatusSchema.optional(),
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
  offset: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(z.number().int().min(0).max(10000))
    .optional(),
  filter: z.enum(["upcoming", "past"]).optional(),
});
export type UpcomingLessonsQuery = z.infer<typeof UpcomingLessonsQuerySchema>;

export const UpcomingLessonsCountResponseSchema = z.object({
  count: z.number().int().min(0),
});
export type UpcomingLessonsCountResponse = z.infer<typeof UpcomingLessonsCountResponseSchema>;

export const UpcomingLessonSchema = LessonResponseSchema.omit({ householdId: true }).extend({
  locationName: z.string(),
});
export type UpcomingLesson = z.infer<typeof UpcomingLessonSchema>;

// ── Coach schedule ────────────────────────────────────────────────────────────

export const CoachScheduleQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !isNaN(new Date(s).getTime()), { message: "Invalid date" })
    .refine(
      (s) => {
        const d = new Date(s);
        const limit = new Date();
        limit.setFullYear(limit.getFullYear() + 1);
        return d <= limit;
      },
      { message: "Date too far in the future" },
    ),
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
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AvailabilitySeasonSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  startDate: DateStringSchema,
  endDate: DateStringSchema,
  teachesDays: z.array(z.number().int().min(1).max(7)),
  weekdayStartTime: TimeStringSchema.nullable(),
  weekdayEndTime: TimeStringSchema.nullable(),
  weekendStartTime: TimeStringSchema.nullable(),
  weekendEndTime: TimeStringSchema.nullable(),
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
  durationMinutes: LessonDurationMinutesSchema.optional(),
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
    .pipe(LessonDurationMinutesSchema),
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

// ── Coach availability-editor request + response shapes ──────────────────────

export const SeasonWithIsCurrentSchema = AvailabilitySeasonSchema.extend({
  isCurrent: z.boolean(),
});
export type SeasonWithIsCurrent = z.infer<typeof SeasonWithIsCurrentSchema>;

export const CreateSeasonBodySchema = z.object({
  name: z.string().min(1),
  startDate: DateStringSchema,
  endDate: DateStringSchema,
  teachesDays: z.array(z.number().int().min(1).max(7)).min(1),
  weekdayStartTime: TimeStringSchema.nullable(),
  weekdayEndTime: TimeStringSchema.nullable(),
  weekendStartTime: TimeStringSchema.nullable(),
  weekendEndTime: TimeStringSchema.nullable(),
  startsAtDst: z.boolean().optional(),
});
export type CreateSeasonBody = z.infer<typeof CreateSeasonBodySchema>;

export const PatchSeasonBodySchema = z.object({
  name: z.string().min(1).optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  teachesDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
  weekdayStartTime: TimeStringSchema.nullable().optional(),
  weekdayEndTime: TimeStringSchema.nullable().optional(),
  weekendStartTime: TimeStringSchema.nullable().optional(),
  weekendEndTime: TimeStringSchema.nullable().optional(),
  startsAtDst: z.boolean().optional(),
});
export type PatchSeasonBody = z.infer<typeof PatchSeasonBodySchema>;

export const CreateOverrideBodySchema = z.object({
  kind: AvailabilityOverrideKindSchema,
  startDate: DateStringSchema,
  endDate: DateStringSchema,
  startTime: TimeStringSchema.optional(),
  endTime: TimeStringSchema.optional(),
  note: z.string().max(500).optional(),
});
export type CreateOverrideBody = z.infer<typeof CreateOverrideBodySchema>;

export const PatchOverrideBodySchema = z.object({
  kind: AvailabilityOverrideKindSchema.optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  startTime: TimeStringSchema.nullable().optional(),
  endTime: TimeStringSchema.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type PatchOverrideBody = z.infer<typeof PatchOverrideBodySchema>;

export const ImpactWarningSchema = z.object({
  lessonId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  reason: z.enum(["outside_hours", "day_closed"]),
  swimmerFirstNames: z.array(z.string()),
  poolName: z.string(),
});
export type ImpactWarning = z.infer<typeof ImpactWarningSchema>;

export const SeasonMutationResponseSchema = z.object({
  season: SeasonWithIsCurrentSchema,
  warnings: z.array(ImpactWarningSchema),
});
export type SeasonMutationResponse = z.infer<typeof SeasonMutationResponseSchema>;

export const SeasonDeleteResponseSchema = z.object({
  warnings: z.array(ImpactWarningSchema),
});
export type SeasonDeleteResponse = z.infer<typeof SeasonDeleteResponseSchema>;

export const OverrideMutationResponseSchema = z.object({
  override: AvailabilityOverrideSchema,
  warnings: z.array(ImpactWarningSchema),
});
export type OverrideMutationResponse = z.infer<typeof OverrideMutationResponseSchema>;

export const OverrideDeleteResponseSchema = z.object({
  warnings: z.array(ImpactWarningSchema),
});
export type OverrideDeleteResponse = z.infer<typeof OverrideDeleteResponseSchema>;

export const CopyNextYearResponseSchema = z.object({
  inserted: z.array(AvailabilitySeasonSchema),
});
export type CopyNextYearResponse = z.infer<typeof CopyNextYearResponseSchema>;

// ── Coach schedule types ──────────────────────────────────────────────────────

export const CoachLessonSwimmerSchema = LessonSwimmerSchema.extend({
  clubName: z.string().nullable(),
});
export type CoachLessonSwimmer = z.infer<typeof CoachLessonSwimmerSchema>;

export const CoachLessonResponseSchema = LessonResponseSchema.extend({
  swimmers: z.array(CoachLessonSwimmerSchema),
});
export type CoachLessonResponse = z.infer<typeof CoachLessonResponseSchema>;

export const CoachScheduleLessonItemSchema = z.object({
  type: z.literal("lesson"),
  lesson: CoachLessonResponseSchema,
  locationName: z.string(),
  householdId: z.string().uuid(),
});
export type CoachScheduleLessonItem = z.infer<typeof CoachScheduleLessonItemSchema>;

export const CoachScheduleItemSchema = z.discriminatedUnion("type", [
  CoachScheduleLessonItemSchema,
  ScheduleTravelBufferItemSchema,
  ScheduleOpenSlotItemSchema,
]);
export type CoachScheduleItem = z.infer<typeof CoachScheduleItemSchema>;

export const CoachLessonDetailSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  householdName: z.string().nullable(),
  locationId: z.string().uuid(),
  locationName: z.string(),
  locationAddress: z.string(),
  locationCity: z.string(),
  locationState: z.string(),
  locationZip: z.string(),
  isHomePool: z.boolean(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  type: LessonTypeSchema,
  status: LessonStatusSchema,
  swimmers: z.array(CoachLessonSwimmerSchema),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  approvedAt: z.string().datetime({ offset: true }).nullable(),
  declinedAt: z.string().datetime({ offset: true }).nullable(),
  declineReason: z.string().nullable(),
  movedAt: z.string().datetime({ offset: true }).nullable(),
  previousStartsAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type CoachLessonDetail = z.infer<typeof CoachLessonDetailSchema>;

export const AvailabilityPreviewQuerySchema = z.object({
  from: DateStringSchema,
  days: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(z.number().int().min(1).max(31)),
});
export type AvailabilityPreviewQuery = z.infer<typeof AvailabilityPreviewQuerySchema>;

export const AvailabilityPreviewDaySchema = z.object({
  date: DateStringSchema,
  state: z.enum(["open", "closed"]),
  windows: z.array(TeachingWindowSchema),
});
export type AvailabilityPreviewDay = z.infer<typeof AvailabilityPreviewDaySchema>;

export const AvailabilityPreviewResponseSchema = z.object({
  days: z.array(AvailabilityPreviewDaySchema),
});
export type AvailabilityPreviewResponse = z.infer<typeof AvailabilityPreviewResponseSchema>;

// ── Coach week schedule ────────────────────────────────────────────────────────

export const CoachWeekScheduleQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !isNaN(new Date(s).getTime()), { message: "Invalid date" }),
});
export type CoachWeekScheduleQuery = z.infer<typeof CoachWeekScheduleQuerySchema>;

export const CoachWeekScheduleDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: CoachScheduleLessonItemSchema.array(),
});
export type CoachWeekScheduleDay = z.infer<typeof CoachWeekScheduleDaySchema>;

export const CoachWeekScheduleResponseSchema = z.object({
  days: CoachWeekScheduleDaySchema.array(),
});
export type CoachWeekScheduleResponse = z.infer<typeof CoachWeekScheduleResponseSchema>;

// ── Coach booking (ADR 029) ──────────────────────────────────────────────────

// Server-computed warnings for a coach custom-time submission. See ADR 029
// "custom-time override rules" for the semantics of each flag. The client
// mirrors this shape for its acknowledgements field; the server never trusts
// the client to self-report which warnings fired.
export const CoachBookingWarningsSchema = z.object({
  outsideHours: z.boolean().default(false),
  insideNoticeWindow: z.boolean().default(false),
  maxAdvanceExceeded: z.boolean().default(false),
  travelBufferViolated: z.boolean().default(false),
  dailyCapExceeded: z.boolean().default(false),
  blockedTimeOverlap: z.boolean().default(false),
});
export type CoachBookingWarnings = z.infer<typeof CoachBookingWarningsSchema>;

export const CoachCreateLessonBodySchema = z.object({
  householdId: z.string().uuid(),
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
  locationId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  // overrideWindow = "may I proceed if there are warnings?". Zero warnings
  // → the flag is a no-op. One or more warnings → every one must appear
  // true in acknowledgedWarnings OR the server returns 409.
  overrideWindow: z.boolean().default(false),
  acknowledgedWarnings: CoachBookingWarningsSchema.default({}),
});
export type CoachCreateLessonBody = z.infer<typeof CoachCreateLessonBodySchema>;

// 409 body shape: the server-computed warnings the coach has not yet
// acknowledged. The UI re-renders its warnings card from this payload.
export const CoachCreateLessonWarningsResponseSchema = z.object({
  error: z.literal("warnings_not_acknowledged"),
  warnings: CoachBookingWarningsSchema,
});
export type CoachCreateLessonWarningsResponse = z.infer<
  typeof CoachCreateLessonWarningsResponseSchema
>;

// ── Coach household search ──────────────────────────────────────────────────

export const COACH_HOUSEHOLD_SEARCH_MIN_LENGTH = 2;

// Either `q` (contains search across swimmer/member/household name) or
// `householdId` (direct lookup for the /coach/book pre-fill path from
// /coach/swimmers/[id]). Both set: householdId wins. Neither set: empty.
export const CoachHouseholdSearchQuerySchema = z.object({
  q: z.string().trim().optional(),
  householdId: z.string().uuid().optional(),
  limit: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(z.number().int().min(1).max(50))
    .optional(),
});
export type CoachHouseholdSearchQuery = z.infer<typeof CoachHouseholdSearchQuerySchema>;

export const CoachHouseholdSearchSwimmerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export type CoachHouseholdSearchSwimmer = z.infer<typeof CoachHouseholdSearchSwimmerSchema>;

export const CoachHouseholdSearchResultSchema = z.object({
  householdId: z.string().uuid(),
  householdName: z.string(),
  memberFullNames: z.array(z.string()),
  swimmers: z.array(CoachHouseholdSearchSwimmerSchema),
  homePoolLocationId: z.string().uuid().nullable(),
});
export type CoachHouseholdSearchResult = z.infer<typeof CoachHouseholdSearchResultSchema>;

export const CoachHouseholdSearchResponseSchema = z.array(CoachHouseholdSearchResultSchema);
export type CoachHouseholdSearchResponse = z.infer<typeof CoachHouseholdSearchResponseSchema>;
