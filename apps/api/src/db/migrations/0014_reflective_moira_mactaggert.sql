CREATE TYPE "public"."lesson_status" AS ENUM('pending', 'approved', 'declined', 'expired', 'canceled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."lesson_type" AS ENUM('private', 'family');--> statement-breakpoint
CREATE TABLE "lesson_swimmers" (
	"lesson_id" uuid NOT NULL,
	"swimmer_id" uuid NOT NULL,
	CONSTRAINT "lesson_swimmers_lesson_id_swimmer_id_pk" PRIMARY KEY("lesson_id","swimmer_id")
);
--> statement-breakpoint
ALTER TABLE "lesson_swimmers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"type" "lesson_type" NOT NULL,
	"status" "lesson_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"declined_at" timestamp with time zone,
	"declined_by" uuid,
	"decline_reason" text,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"no_show_at" timestamp with time zone,
	"no_show_by" uuid,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"google_calendar_event_id" text,
	"calendar_sync_status" text DEFAULT 'not_synced' NOT NULL,
	"calendar_sync_error" text,
	"calendar_sync_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_duration_valid" CHECK ("lessons"."duration_minutes" IN (30, 45, 60)),
	CONSTRAINT "lessons_calendar_sync_status_valid" CHECK ("lessons"."calendar_sync_status" IN ('not_synced', 'synced', 'sync_failed'))
);
--> statement-breakpoint
ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_swimmers" ADD CONSTRAINT "lesson_swimmers_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_swimmers" ADD CONSTRAINT "lesson_swimmers_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_location_id_lesson_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."lesson_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_requested_by_profiles_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_declined_by_profiles_id_fk" FOREIGN KEY ("declined_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_canceled_by_profiles_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_no_show_by_profiles_id_fk" FOREIGN KEY ("no_show_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;