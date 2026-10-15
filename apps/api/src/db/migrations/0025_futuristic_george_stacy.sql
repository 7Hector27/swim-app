CREATE TYPE "public"."course" AS ENUM('scy', 'scm', 'lcm');--> statement-breakpoint
CREATE TYPE "public"."swim_stroke" AS ENUM('free', 'back', 'breast', 'fly', 'im');--> statement-breakpoint
CREATE TYPE "public"."swim_type" AS ENUM('meet', 'practice');--> statement-breakpoint
CREATE TABLE "meet_swims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"meet_id" uuid,
	"swim_type" "swim_type" DEFAULT 'meet' NOT NULL,
	"event_distance" integer NOT NULL,
	"event_stroke" "swim_stroke" NOT NULL,
	"course" "course" NOT NULL,
	"swum_on" date NOT NULL,
	"time_hundredths" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meet_swims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"meet_date" date NOT NULL,
	"course" "course" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meet_swims" ADD CONSTRAINT "meet_swims_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_swims" ADD CONSTRAINT "meet_swims_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "public"."meets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_swims" ADD CONSTRAINT "meet_swims_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meets" ADD CONSTRAINT "meets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;