export type { IdParams } from "./schemas/params";
export { IdParamsSchema } from "./schemas/params";

export type { HealthResponse } from "./schemas/health";
export { HealthQuerySchema, HealthResponseSchema } from "./schemas/health";

export type { MeResponse, PatchMeBody, CoachPingResponse } from "./schemas/profile";
export { MeResponseSchema, PatchMeBodySchema, CoachPingResponseSchema } from "./schemas/profile";

export type { SignUpBody, LoginBody } from "./schemas/auth";
export { SignUpBodySchema, LoginBodySchema } from "./schemas/auth";

export type {
  Sex,
  Swimmer,
  Guardian,
  Club,
  SwimmerClub,
  SwimmerClubInput,
  CreateSwimmerBody,
  UpdateSwimmerBody,
  ParentSwimmer,
  PublicSwimmer,
} from "./schemas/swimmer";
export {
  SexSchema,
  SwimmerBaseSchema,
  SwimmerSchema,
  GuardianSchema,
  ClubSchema,
  SwimmerClubBaseSchema,
  SwimmerClubSchema,
  SwimmerClubInputSchema,
  CreateSwimmerBodySchema,
  UpdateSwimmerBodySchema,
  ParentSwimmerSchema,
  PublicSwimmerSchema,
} from "./schemas/swimmer";

export { calculateAge } from "./lib/calculateAge";
export { todayLA } from "./lib/todayLA";
