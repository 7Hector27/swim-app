import { z } from "zod";

import { isQuarterHour } from "../lib/quarterHour";

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
  .refine(isQuarterHour, { message: "Time must be on a 15-minute step." });

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
    bookingMinAdvanceHours: z.number().int().min(0).max(168).optional(),
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
  // Null means the block covers every pool. See ADR 033.
  locationId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type BlockedTime = z.infer<typeof BlockedTimeSchema>;

export const CreateBlockedTimeBodySchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  locationId: z.string().uuid().optional(),
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

// Coach-only query flag that disables the min-advance notice filter on
// availability lookups. Server honors it only when the caller is a coach —
// parents passing it still see the normal rule applied. The notice window
// is configurable via availability_config.bookingMinAdvanceHours.
// Shape is a plain string so URLSearchParams round-trips cleanly.
export const CoachBypassNoticeFlagSchema = z.literal("true").optional();

export const AvailableSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(LessonDurationMinutesSchema),
  locationId: z.string().uuid(),
  coachBypassNotice: CoachBypassNoticeFlagSchema,
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
  // Nullable on anonymized rows per ADR 034: when the household that owned
  // this lesson was deleted, the identity columns are nulled but the row
  // survives on the coach side. Parent-facing routes filter by household_id,
  // so parent responses never carry a null here at runtime — the null is a
  // coach-side surface.
  householdId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
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
  // Set when the lesson was booked as part of a batch submission (ADR 030).
  // Nullable + optional so existing construction sites that don't need the
  // batch metadata can omit the fields entirely. Pending-list grouping on
  // the coach side consumes them from the /coach/lessons endpoint.
  batchId: z.string().uuid().nullable().optional(),
  batchMode: z.enum(["manual", "weekly"]).nullable().optional(),
  // Anonymization markers (ADR 034). Non-null on rows whose household was
  // deleted; null on live rows. The coach UI reads these to show
  // "Deleted family" and the location snapshot in place of the real
  // household/location.
  anonymizedAt: z.string().datetime({ offset: true }).nullable().optional(),
  locationSnapshot: z.string().nullable().optional(),
  swimmerCount: z.number().int().nullable().optional(),
});
export type LessonResponse = z.infer<typeof LessonResponseSchema>;

export const ApproveLessonBodySchema = z.object({});
export type ApproveLessonBody = z.infer<typeof ApproveLessonBodySchema>;

// Coach-only no-show mark + undo. Both bodies are empty; the route alone
// carries the intent. See apps/api/src/routes/coachLessons.ts.
export const MarkNoShowBodySchema = z.object({});
export type MarkNoShowBody = z.infer<typeof MarkNoShowBodySchema>;
export const UndoNoShowBodySchema = z.object({});
export type UndoNoShowBody = z.infer<typeof UndoNoShowBodySchema>;

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

export const UpcomingLessonSchema = LessonResponseSchema
  .omit({ householdId: true, locationId: true, anonymizedAt: true, locationSnapshot: true, swimmerCount: true })
  .extend({
    // Non-null on the parent side — parent routes filter by household_id,
    // so an anonymized row (whose household_id is null) never appears here.
    // ADR 034.
    locationId: z.string().uuid(),
    locationName: z.string(),
    // Set when the lesson was booked as part of a multi-lesson or weekly batch.
    // Dashboard uses `batchMode` to render a small "Weekly" / "Multi-booking"
    // label next to the lesson.
    batchId: z.string().uuid().nullable(),
    batchMode: z.enum(["manual", "weekly"]).nullable(),
  });
export type UpcomingLesson = z.infer<typeof UpcomingLessonSchema>;

export const UpcomingLessonsResponseSchema = z.object({
  items: UpcomingLessonSchema.array(),
  total: z.number().int().min(0),
});
export type UpcomingLessonsResponse = z.infer<typeof UpcomingLessonsResponseSchema>;

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
  view:              z.enum(["week", "month"]),
  date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes:   z
    .string()
    .transform((value) => parseInt(value, 10))
    .pipe(LessonDurationMinutesSchema),
  locationId:        z.string().uuid(),
  excludeLessonId:   z.string().uuid().optional(),
  coachBypassNotice: CoachBypassNoticeFlagSchema,
});
export type RangeAvailabilityQuery = z.infer<typeof RangeAvailabilityQuerySchema>;

export const MonthAvailabilityResponseSchema = z.object({
  needsApproval: z.boolean(),
  days:          z.array(DayAvailabilitySchema),
  // Daily lesson-minutes cap echoed from availability_config. Clients use it
  // to grey out unpicked slots that would push a day past the cap once
  // all current picks are counted.
  maxDailyLessonMinutes: z.number().int().positive(),
  // Rolling booking-window length echoed from availability_config. Clients
  // use it to measure the window the same way the server does, so the
  // calendar's "not open yet" boundary matches the server's filter.
  bookingMaxAdvanceWeeks: z.number().int().positive(),
  // Parent min-advance notice window (whole hours) echoed from
  // availability_config so client copy ("Less than N hours away") stays in
  // sync with the server rule.
  bookingMinAdvanceHours: z.number().int().min(0),
});
export type MonthAvailabilityResponse = z.infer<typeof MonthAvailabilityResponseSchema>;

export const WeekAvailabilityResponseSchema = z.object({
  needsApproval: z.boolean(),
  days:          z.array(WeekDayAvailabilitySchema),
  maxDailyLessonMinutes: z.number().int().positive(),
  bookingMaxAdvanceWeeks: z.number().int().positive(),
  bookingMinAdvanceHours: z.number().int().min(0),
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
  weekdayStartTime: QuarterHourTimeStringSchema.nullable(),
  weekdayEndTime: QuarterHourTimeStringSchema.nullable(),
  weekendStartTime: QuarterHourTimeStringSchema.nullable(),
  weekendEndTime: QuarterHourTimeStringSchema.nullable(),
  startsAtDst: z.boolean().optional(),
});
export type CreateSeasonBody = z.infer<typeof CreateSeasonBodySchema>;

export const PatchSeasonBodySchema = z.object({
  name: z.string().min(1).optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  teachesDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
  weekdayStartTime: QuarterHourTimeStringSchema.nullable().optional(),
  weekdayEndTime: QuarterHourTimeStringSchema.nullable().optional(),
  weekendStartTime: QuarterHourTimeStringSchema.nullable().optional(),
  weekendEndTime: QuarterHourTimeStringSchema.nullable().optional(),
  startsAtDst: z.boolean().optional(),
});
export type PatchSeasonBody = z.infer<typeof PatchSeasonBodySchema>;

export const CreateOverrideBodySchema = z.object({
  kind: AvailabilityOverrideKindSchema,
  startDate: DateStringSchema,
  endDate: DateStringSchema,
  startTime: QuarterHourTimeStringSchema.optional(),
  endTime: QuarterHourTimeStringSchema.optional(),
  note: z.string().max(500).optional(),
});
export type CreateOverrideBody = z.infer<typeof CreateOverrideBodySchema>;

export const PatchOverrideBodySchema = z.object({
  kind: AvailabilityOverrideKindSchema.optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  startTime: QuarterHourTimeStringSchema.nullable().optional(),
  endTime: QuarterHourTimeStringSchema.nullable().optional(),
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
  // Nullable on anonymized rows per ADR 034. The lesson itself carries
  // `anonymizedAt` so the client can distinguish; this field stays here
  // for existing consumers that need the household context.
  householdId: z.string().uuid().nullable(),
  // "Deleted family" when the row is anonymized; otherwise the actual
  // household name. Added so the coach schedule can label anonymized
  // history without a second lookup. ADR 034.
  householdName: z.string().optional(),
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
  // Identity fields are nullable on anonymized rows per ADR 034.
  householdId: z.string().uuid().nullable(),
  householdName: z.string().nullable(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string(),
  locationAddress: z.string().nullable(),
  locationCity: z.string().nullable(),
  locationState: z.string().nullable(),
  locationZip: z.string().nullable(),
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
  // Anonymization markers (ADR 034). Non-null on rows whose household was
  // deleted. When set, householdName is "Deleted family", locationName is
  // the coarse snapshot ("Home pool" or named-pool name), swimmers is [],
  // and the address columns are null.
  anonymizedAt: z.string().datetime({ offset: true }).nullable().optional(),
  locationSnapshot: z.string().nullable().optional(),
  swimmerCount: z.number().int().nullable().optional(),
});
export type CoachLessonDetail = z.infer<typeof CoachLessonDetailSchema>;

// ── Coach batch detail ─────────────────────────────────────────────────────────

// One lesson row in the batch detail view. Lean on purpose — the row renders
// an at-a-glance list and taps through to /coach/lessons/[id] for full detail.
export const CoachBatchLessonSchema = z.object({
  id: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  type: LessonTypeSchema,
  status: LessonStatusSchema,
  locationId: z.string().uuid(),
  locationName: z.string(),
  swimmers: z.array(LessonSwimmerSchema),
});
export type CoachBatchLesson = z.infer<typeof CoachBatchLessonSchema>;

export const CoachBatchDetailSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(["manual", "weekly"]),
  householdName: z.string().nullable(),
  // Full name of the household member who submitted the batch, snapshotted
  // from profiles.full_name at read time (not frozen — a later rename
  // propagates).
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  // Ordered by startsAt ascending. Cancelled/no-show lessons are included
  // (the UI shows them with their status).
  lessons: z.array(CoachBatchLessonSchema),
});
export type CoachBatchDetail = z.infer<typeof CoachBatchDetailSchema>;

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
//
// Note: the 16-hour notice window is a parent-only rule — coaches book
// without any min-advance restriction, so there is no insideNoticeWindow
// warning. Start-in-past is a hard reject in POST /coach/lessons.
export const CoachBookingWarningsSchema = z.object({
  outsideHours: z.boolean().default(false),
  maxAdvanceExceeded: z.boolean().default(false),
  travelBufferViolated: z.boolean().default(false),
  dailyCapExceeded: z.boolean().default(false),
  blockedTimeOverlap: z.boolean().default(false),
});
export type CoachBookingWarnings = z.infer<typeof CoachBookingWarningsSchema>;

// How the coach-booked lesson is paid (ADR 036 §4). `balance` charges the
// family's balance like a parent booking — the server refuses with
// insufficient_balance if the household can't cover it. `free` marks the
// lesson as a comp (no charge, no refund on cancel) and writes a
// `free_lesson` ledger marker for audit completeness.
export const CoachChargeTypeSchema = z.enum(["balance", "free"]);
export type CoachChargeType = z.infer<typeof CoachChargeTypeSchema>;

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
  // ADR 036 Phase 4. Defaults to 'balance' so a coach that forgets to
  // pass the field doesn't accidentally give a free lesson.
  chargeType: CoachChargeTypeSchema.default("balance"),
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

// Archived swimmers appear in the household search so the picker can grey
// them out, but we only expose the fact that they're archived — never the
// archivedAt timestamp. The parent can't see when their own swimmer was
// archived, and the coach has no need to either.
export const CoachHouseholdSearchSwimmerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  isArchived: z.boolean(),
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

// ── Batch booking (ADR 030) ──────────────────────────────────────────────────

// A batch is 1 to 20 lessons submitted together through POST /lessons/batch
// (parents only). Manual mode supplies the explicit start times; weekly mode
// supplies a weekday set, a time of day, a start date, and a week count.
export const BATCH_LESSON_MIN = 1;
export const BATCH_LESSON_MAX = 20;

export const BatchModeSchema = z.enum(["manual", "weekly"]);
export type BatchMode = z.infer<typeof BatchModeSchema>;

export const BatchPickSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  // Per-pick swimmers (ADR 030 phase 2 update). Each pick captures the
  // swimmer set the parent chose at tap time, so a Multiple batch can
  // interleave different kids and the server books each lesson against
  // the pick's own list rather than a batch-wide one.
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
});
export type BatchPick = z.infer<typeof BatchPickSchema>;

// Shape of each returned pick in the preview response. `index` is the
// stable position inside the full candidate list (manual: picks array
// index; weekly: expanded index 0..weekdays.length*weeks-1).
export const BatchPickStateSchema = z.enum([
  "available",
  "unavailable",
  "too_soon",
  "past",
  "not_open_yet",
  "outside_hours",
  "blocked_time",
  "day_closed",
  "conflicts_batch",
]);
export type BatchPickState = z.infer<typeof BatchPickStateSchema>;

export const BatchPickSuggestionSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});

export const BatchPreviewPickSchema = z.object({
  index: z.number().int().nonnegative(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  // Echo back the pick's swimmers so the Review sheet can show each row's
  // first names without re-indexing against the request body.
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
  state: BatchPickStateSchema,
  reason: z.string().optional(),
  suggestions: z.array(BatchPickSuggestionSchema).max(3).optional(),
});
export type BatchPreviewPick = z.infer<typeof BatchPreviewPickSchema>;

// Each pick's startsAt in manual picks must be unique — duplicates are a
// client bug, not a silent dedupe.
function picksHaveDistinctStarts(
  picks: { startsAt: string }[],
): boolean {
  return new Set(picks.map((p) => p.startsAt)).size === picks.length;
}

// Discriminated-union members must be raw ZodObjects. The cross-field
// invariants (manual picks are distinct; weekly expands to [MIN, MAX]
// lessons; weekdays are unique) live in a shared `superRefine` applied to
// the union below.
const batchManualBase = z.object({
  mode: z.literal("manual"),
  householdId: z.string().uuid(),
  locationId: z.string().uuid(),
  // Each pick carries its own durationMinutes + swimmerIds. One batch can
  // mix 30, 45, and 60-minute lessons across different swimmers; the
  // household and pool stay batch-wide.
  picks: z.array(BatchPickSchema).min(BATCH_LESSON_MIN).max(BATCH_LESSON_MAX),
});

// A single (weekday, time, length) entry in a recurring batch's pattern. For
// example Tue 4:30 PM, 45 min. The pattern is an ordered list of these; the
// server expands each entry across N weeks starting from `startDate`. Each
// entry's lesson length is independent of the others.
export const BatchPatternPairSchema = z.object({
  // ISO weekday (1=Mon … 7=Sun).
  weekday: z.number().int().min(1).max(7),
  // Local America/Los_Angeles time, zero-padded. Example: "16:30".
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, "timeOfDay must be HH:MM"),
  durationMinutes: LessonDurationMinutesSchema,
  // Per-entry swimmers. Each candidate expanded from this pair inherits
  // this list so a recurring series can run different kids on different
  // (weekday, time) slots. See ADR 030 phase 2.
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
});
export type BatchPatternPair = z.infer<typeof BatchPatternPairSchema>;

// Shape of the booking_batches.weekly_pattern jsonb column (ADR 030 phase 2).
//
// The stored pattern is HISTORY ONLY. Nothing re-expands it — concrete lessons
// (including per-lesson swimmer sets) are already materialized in `lessons`
// and `lesson_swimmers` at submit time. Cancel-remaining reads from `lessons`,
// not from the pattern, and the email outbox payload embeds the pattern as an
// archival snapshot that no renderer currently reads.
//
// Writes always carry swimmerIds (see BatchPatternPairSchema). Reads use the
// looser StoredWeeklyPatternReadSchema below so rows written before ADR 030
// phase 2 — which are missing swimmerIds — still parse.
export const StoredWeeklyPatternSchema = z.array(BatchPatternPairSchema).min(1);
export type StoredWeeklyPattern = z.infer<typeof StoredWeeklyPatternSchema>;

const StoredWeeklyPatternPairReadSchema = BatchPatternPairSchema.extend({
  swimmerIds: z.array(z.string().uuid()).min(1).max(4).optional(),
});
export const StoredWeeklyPatternReadSchema = z
  .array(StoredWeeklyPatternPairReadSchema)
  .min(1);
export type StoredWeeklyPatternRead = z.infer<typeof StoredWeeklyPatternReadSchema>;

const batchWeeklyBase = z.object({
  mode: z.literal("weekly"),
  householdId: z.string().uuid(),
  locationId: z.string().uuid(),
  // Ordered list of (weekday, time, duration, swimmerIds) entries. The
  // expanded candidate list is pattern.length * weeks lessons; order inside
  // the pattern determines the stable index assignment, and each candidate
  // inherits its swimmer set from the entry it was expanded from.
  pattern: z.array(BatchPatternPairSchema).min(1).max(BATCH_LESSON_MAX),
  // LA calendar date of the first candidate week. Example: "2026-11-02".
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  weeks: z.number().int().min(1).max(BATCH_LESSON_MAX),
});

function applyBatchInvariants(
  body:
    | z.infer<typeof batchManualBase>
    | (z.infer<typeof batchWeeklyBase> & { overrides?: unknown; skips?: unknown }),
  ctx: z.RefinementCtx,
): void {
  if (body.mode === "manual") {
    if (!picksHaveDistinctStarts(body.picks)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["picks"],
        message: "picks must have distinct startsAt values",
      });
    }
    return;
  }
  // weekly
  const patternKeys = body.pattern.map((pair) => `${pair.weekday}@${pair.timeOfDay}`);
  if (new Set(patternKeys).size !== patternKeys.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pattern"],
      message: "pattern pairs must be unique on (weekday, timeOfDay)",
    });
  }
  const expanded = body.pattern.length * body.weeks;
  if (expanded < BATCH_LESSON_MIN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["weeks"],
      message: `A batch must have at least ${BATCH_LESSON_MIN} ${BATCH_LESSON_MIN === 1 ? "lesson" : "lessons"}.`,
    });
  }
  if (expanded > BATCH_LESSON_MAX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["weeks"],
      message: `A batch cannot have more than ${BATCH_LESSON_MAX} lessons.`,
    });
  }
}

// Preview body. For weekly mode the server expands candidates from the four
// fields and runs the slot engine for each.
export const BatchPreviewBodySchema = z.discriminatedUnion("mode", [
  batchManualBase,
  batchWeeklyBase,
]).superRefine(applyBatchInvariants);
export type BatchPreviewBody = z.infer<typeof BatchPreviewBodySchema>;

export const BatchPreviewResponseSchema = z.object({
  needsApproval: z.boolean(),
  picks: z.array(BatchPreviewPickSchema),
});
export type BatchPreviewResponse = z.infer<typeof BatchPreviewResponseSchema>;

// Submit body. Manual mode submits the same shape as preview. Weekly mode
// adds `overrides` (per-expanded-index replacement startsAt) and `skips`
// (indexes to drop).
export const BatchWeeklyOverrideSchema = z.object({
  index: z.number().int().nonnegative(),
  startsAt: z.string().datetime({ offset: true }),
});
export type BatchWeeklyOverride = z.infer<typeof BatchWeeklyOverrideSchema>;

const batchWeeklySubmitBase = batchWeeklyBase.extend({
  overrides: z.array(BatchWeeklyOverrideSchema).max(BATCH_LESSON_MAX).default([]),
  skips: z.array(z.number().int().nonnegative()).max(BATCH_LESSON_MAX).default([]),
});

export const BatchSubmitBodySchema = z.discriminatedUnion("mode", [
  batchManualBase,
  batchWeeklySubmitBase,
]).superRefine(applyBatchInvariants);
export type BatchSubmitBody = z.infer<typeof BatchSubmitBodySchema>;

export const BatchSubmitSuccessResponseSchema = z.object({
  batchId: z.string().uuid(),
  mode: BatchModeSchema,
  lessonIds: z.array(z.string().uuid()),
  confirmedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
});
export type BatchSubmitSuccessResponse = z.infer<typeof BatchSubmitSuccessResponseSchema>;

export const BatchConflictPickSchema = z.object({
  index: z.number().int().nonnegative(),
  startsAt: z.string().datetime({ offset: true }),
  state: BatchPickStateSchema,
  reason: z.string().optional(),
});
export type BatchConflictPick = z.infer<typeof BatchConflictPickSchema>;

export const BatchSubmitConflictResponseSchema = z.object({
  error: z.literal("picks_conflict"),
  conflicts: z.array(BatchConflictPickSchema).min(1),
});
export type BatchSubmitConflictResponse = z.infer<typeof BatchSubmitConflictResponseSchema>;

// ── Coach approve-pending (ADR 030 phase 3) ───────────────────────────────
//
// PATCH /coach/lessons/batch/:batchId/approve-pending flips every pending
// lesson in a batch to approved in one transaction, snapshots+bumps each
// one's calendar_sequence, writes one audit row and one batch_approved
// outbox row covering only the newly approved lessons.

export const CoachBatchApproveResponseSchema = z.object({
  batchId: z.string().uuid(),
  approvedLessonIds: z.array(z.string().uuid()),
  approvedCount: z.number().int().nonnegative(),
});
export type CoachBatchApproveResponse = z.infer<typeof CoachBatchApproveResponseSchema>;

// ── Parent cancel-remaining (ADR 030 phase 3) ─────────────────────────────
//
// DELETE /lessons/batch/:batchId/remaining cancels every future-dated
// pending or approved lesson in the batch in one transaction. CANCEL
// VEVENTs ship for the lessons that had invites; pending ones appear in
// the body text only.

export const BatchCancelRemainingResponseSchema = z.object({
  batchId: z.string().uuid(),
  canceledLessonIds: z.array(z.string().uuid()),
  canceledCount: z.number().int().nonnegative(),
});
export type BatchCancelRemainingResponse = z.infer<typeof BatchCancelRemainingResponseSchema>;

export type CoachHouseholdSearchResponse = z.infer<typeof CoachHouseholdSearchResponseSchema>;

// ── Coach bulk cancel (ADR 033) ───────────────────────────────────────────────

// Hard cap on the message length. Reused as the decline_reason for pending
// lessons declined by the operation, so it matches DECLINE_REASON_MAX_LENGTH.
export const BULK_CANCEL_MESSAGE_MAX_LENGTH = DECLINE_REASON_MAX_LENGTH;

// LA calendar date, YYYY-MM-DD.
const LaDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date",
  });

// LA wall-clock time, HH:MM on a 15-minute step. Matches
// QuarterHourTimeStringSchema's shape; declared locally so this file stays
// self-contained for the bulk-cancel exports.
const LaTimeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .refine(
    (value) => {
      const parts = value.split(":");
      const hour = Number.parseInt(parts[0] ?? "", 10);
      const minute = Number.parseInt(parts[1] ?? "", 10);
      if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
      if (hour < 0 || hour > 23) return false;
      if (minute !== 0 && minute !== 15 && minute !== 30 && minute !== 45) return false;
      return true;
    },
    { message: "Time must be HH:MM on a 15-minute step." },
  );

// Both-or-neither time window, with end strictly after start. The DB CHECKs
// mirror this (bulk_cancellations_time_window_pair, bulk_cancellations_
// end_after_start_time) so bypassing the schema still fails at the DB.
const BulkCancelRangeSchema = z
  .object({
    startDate: LaDateStringSchema,
    endDate: LaDateStringSchema,
    locationId: z.string().uuid().optional(),
    startTime: LaTimeStringSchema.optional(),
    endTime: LaTimeStringSchema.optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .refine(
    (data) =>
      (data.startTime === undefined && data.endTime === undefined) ||
      (data.startTime !== undefined && data.endTime !== undefined),
    { message: "startTime and endTime must both be set or both omitted", path: ["endTime"] },
  )
  .refine(
    (data) =>
      data.startTime === undefined ||
      data.endTime === undefined ||
      data.endTime > data.startTime,
    { message: "endTime must be after startTime", path: ["endTime"] },
  );

export const BulkCancelPreviewBodySchema = BulkCancelRangeSchema;
export type BulkCancelPreviewBody = z.infer<typeof BulkCancelPreviewBodySchema>;

export const BulkCancelPreviewLessonSchema = z.object({
  lessonId: z.string().uuid(),
  householdId: z.string().uuid(),
  householdName: z.string(),
  status: z.enum(["approved", "pending"]),
  startsAt: z.string().datetime({ offset: true }),
  startsAtLocalDisplay: z.string(),
  durationMinutes: LessonDurationMinutesSchema,
  locationId: z.string().uuid(),
  locationName: z.string(),
  swimmerFirstNames: z.array(z.string()),
});
export type BulkCancelPreviewLesson = z.infer<typeof BulkCancelPreviewLessonSchema>;

export const BulkCancelPreviewResponseSchema = z.object({
  startDate: LaDateStringSchema,
  endDate: LaDateStringSchema,
  // Echoed back so the preview UI can render a confirmed window label
  // alongside the user's inputs (and so a stale UI state doesn't disagree
  // with the server's view of what was previewed).
  startTime: LaTimeStringSchema.nullable(),
  endTime: LaTimeStringSchema.nullable(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
  approvedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  householdCount: z.number().int().nonnegative(),
  lessons: z.array(BulkCancelPreviewLessonSchema),
});
export type BulkCancelPreviewResponse = z.infer<typeof BulkCancelPreviewResponseSchema>;

export const BulkCancelConfirmBodySchema = BulkCancelRangeSchema.and(
  z.object({
    message: z.string().max(BULK_CANCEL_MESSAGE_MAX_LENGTH).optional(),
    // Default UI selection is true: write a day-off override (null pool) or a
    // per-day blocked_times row per LA date (pool filtered) so the cleared
    // slots can't be rebooked in the same range.
    blockRange: z.boolean(),
  }),
);
export type BulkCancelConfirmBody = z.infer<typeof BulkCancelConfirmBodySchema>;

export const BulkCancelConfirmResponseSchema = z.object({
  bulkCancellationId: z.string().uuid(),
  canceledLessonCount: z.number().int().nonnegative(),
  declinedLessonCount: z.number().int().nonnegative(),
  affectedHouseholdCount: z.number().int().nonnegative(),
  blockApplied: z.boolean(),
});
export type BulkCancelConfirmResponse = z.infer<typeof BulkCancelConfirmResponseSchema>;
