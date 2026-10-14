CREATE TYPE "public"."start_component" AS ENUM('reaction_time', 'block_position', 'entry_angle', 'entry_point', 'streamline', 'breakout');--> statement-breakpoint
CREATE TABLE "start_component_ratings" (
	"start_rating_id" uuid NOT NULL,
	"component" "start_component" NOT NULL,
	"grade" integer,
	"not_legal" boolean DEFAULT false NOT NULL,
	"no_concept" boolean DEFAULT false NOT NULL,
	CONSTRAINT "start_component_ratings_start_rating_id_component_pk" PRIMARY KEY("start_rating_id","component"),
	CONSTRAINT "start_component_grade_xor_no_concept" CHECK (("start_component_ratings"."no_concept" = false AND "start_component_ratings"."grade" IS NOT NULL AND "start_component_ratings"."grade" >= 1 AND "start_component_ratings"."grade" <= 5)
          OR ("start_component_ratings"."no_concept" = true AND "start_component_ratings"."grade" IS NULL)),
	CONSTRAINT "start_component_not_legal_requires_grade" CHECK ("start_component_ratings"."not_legal" = false OR "start_component_ratings"."grade" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "start_component_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "start_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"stroke" "stroke",
	"rated_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"void_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "start_ratings_void_fields_consistent" CHECK (("start_ratings"."voided_at" IS NULL AND "start_ratings"."void_reason" IS NULL AND "start_ratings"."void_by" IS NULL)
          OR ("start_ratings"."voided_at" IS NOT NULL AND "start_ratings"."void_reason" IS NOT NULL AND "start_ratings"."void_by" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "start_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "start_component_ratings" ADD CONSTRAINT "start_component_ratings_start_rating_id_start_ratings_id_fk" FOREIGN KEY ("start_rating_id") REFERENCES "public"."start_ratings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "start_ratings" ADD CONSTRAINT "start_ratings_session_id_evaluation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."evaluation_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "start_ratings" ADD CONSTRAINT "start_ratings_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "start_ratings" ADD CONSTRAINT "start_ratings_coach_id_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "start_ratings" ADD CONSTRAINT "start_ratings_void_by_profiles_id_fk" FOREIGN KEY ("void_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;