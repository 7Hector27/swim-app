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

export type { HouseholdRole, HouseholdMember, HouseholdResponse } from "./schemas/households";
export { HouseholdRoleSchema, HouseholdMemberSchema, HouseholdResponseSchema, HOUSEHOLD_ROLE_RANK } from "./schemas/households";

export { calculateAge } from "./lib/calculateAge";
export { todayLA } from "./lib/todayLA";
