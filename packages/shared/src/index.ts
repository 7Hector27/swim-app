export type { IdParams } from "./schemas/params";
export { IdParamsSchema } from "./schemas/params";

export type { League, LeagueRegistrationParams } from "./schemas/registration";
export { LeagueSchema, LeagueRegistrationParamsSchema } from "./schemas/registration";

export { currentSeasonStartYear, CLUB_SEASON_START_MONTH } from "./lib/currentSeasonStartYear";

export type { HealthResponse } from "./schemas/health";
export { HealthQuerySchema, HealthResponseSchema } from "./schemas/health";

export type { MeResponse, PatchMeBody, CoachPingResponse } from "./schemas/profile";
export { MeResponseSchema, PatchMeBodySchema, CoachPingResponseSchema } from "./schemas/profile";

export type { SignUpBody, LoginBody } from "./schemas/auth";
export { SignUpBodySchema, LoginBodySchema } from "./schemas/auth";

export type {
  Sex,
  Swimmer,
  Club,
  SwimmerClub,
  SwimmerClubInput,
  CreateSwimmerBody,
  UpdateSwimmerBody,
  ParentSwimmer,
  PublicSwimmer,
  CoachSwimmer,
  CoachSwimmerDetail,
  CoachVisibilityBody,
} from "./schemas/swimmer";
export {
  SexSchema,
  SwimmerBaseSchema,
  SwimmerSchema,
  ClubSchema,
  SwimmerClubBaseSchema,
  SwimmerClubSchema,
  SwimmerClubInputSchema,
  CreateSwimmerBodySchema,
  UpdateSwimmerBodySchema,
  ParentSwimmerSchema,
  PublicSwimmerSchema,
  CoachSwimmerSchema,
  CoachSwimmerDetailSchema,
  CoachVisibilityBodySchema,
} from "./schemas/swimmer";

export type {
  HouseholdRole,
  HouseholdMember,
  HouseholdResponse,
  RenameHouseholdBody,
  ChangeRoleBody,
  TransferOwnershipBody,
  PendingInvite,
  ListInviteResponse,
} from "./schemas/households";
export {
  HouseholdRoleSchema,
  HouseholdMemberSchema,
  HouseholdResponseSchema,
  HOUSEHOLD_ROLE_RANK,
  RenameHouseholdBodySchema,
  ChangeRoleBodySchema,
  TransferOwnershipBodySchema,
  PendingInviteSchema,
  ListInviteResponseSchema,
} from "./schemas/households";

export type { InviteStatus, InviteStatusResponse, GenerateInviteResponse, AcceptInviteResponse } from "./schemas/invites";
export { InviteStatusSchema, InviteStatusResponseSchema, GenerateInviteResponseSchema, AcceptInviteResponseSchema } from "./schemas/invites";

export type {
  SkillType,
  Stroke,
  SkillCategory,
  Skill,
  SkillLevelDescriptor,
  SkillDependency,
  RatingScaleLevel,
} from "./schemas/skills";
export {
  SkillTypeSchema,
  StrokeSchema,
  SkillCategorySchema,
  SkillSchema,
  SkillLevelDescriptorSchema,
  SkillDependencySchema,
  RatingScaleLevelSchema,
} from "./schemas/skills";

export { calculateAge } from "./lib/calculateAge";
export { todayLA } from "./lib/todayLA";
export { isSafeReturnTo } from "./lib/isSafeReturnTo";

export type {
  LessonLocation,
  SetHomePoolBody,
  CreateLocationBody,
  PatchLocationBody,
  AvailabilityConfig,
  PatchAvailabilityConfigBody,
  BlockedTime,
  CreateBlockedTimeBody,
  TravelBufferOverride,
  UpsertTravelBufferBody,
  SeasonSummerEndDate,
  SetSeasonEndDateBody,
  LessonStatus,
  LessonType,
  CreateLessonBody,
  AvailableSlotsQuery,
  LessonSwimmer,
  LessonResponse,
  ApproveLessonBody,
  DeclineLessonBody,
  CoachListLessonsQuery,
  AvailableSlot,
  UpcomingLesson,
  UpcomingLessonsQuery,
  CoachScheduleQuery,
  ScheduleItem,
  ScheduleDay,
  CoachStats,
} from "./schemas/booking";
export {
  LessonLocationSchema,
  SetHomePoolBodySchema,
  CreateLocationBodySchema,
  PatchLocationBodySchema,
  AvailabilityConfigSchema,
  PatchAvailabilityConfigBodySchema,
  BlockedTimeSchema,
  CreateBlockedTimeBodySchema,
  TravelBufferOverrideSchema,
  UpsertTravelBufferBodySchema,
  SeasonSummerEndDateSchema,
  SetSeasonEndDateBodySchema,
  LessonStatusSchema,
  LessonTypeSchema,
  CreateLessonBodySchema,
  AvailableSlotsQuerySchema,
  LessonSwimmerSchema,
  LessonResponseSchema,
  ApproveLessonBodySchema,
  DeclineLessonBodySchema,
  CoachListLessonsQuerySchema,
  AvailableSlotSchema,
  UpcomingLessonSchema,
  UpcomingLessonsQuerySchema,
  CoachScheduleQuerySchema,
  ScheduleItemSchema,
  ScheduleDaySchema,
  CoachStatsSchema,
} from "./schemas/booking";
