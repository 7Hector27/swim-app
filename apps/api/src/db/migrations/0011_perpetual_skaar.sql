CREATE TABLE "availability_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_days" integer[] DEFAULT '{1,2,3,5}' NOT NULL,
	"school_year_start_time" time NOT NULL,
	"school_year_end_time" time NOT NULL,
	"summer_morning_start_time" time NOT NULL,
	"summer_morning_end_time" time NOT NULL,
	"summer_evening_start_time" time NOT NULL,
	"summer_evening_end_time" time NOT NULL,
	"max_daily_lesson_minutes" integer DEFAULT 240 NOT NULL,
	"booking_min_advance_hours" integer DEFAULT 16 NOT NULL,
	"booking_max_advance_weeks" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blocked_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_times_ends_after_starts" CHECK ("blocked_times"."ends_at" > "blocked_times"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "blocked_times" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lesson_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text DEFAULT 'CA' NOT NULL,
	"zip" text NOT NULL,
	"household_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "season_summer_end_dates" (
	"year" integer PRIMARY KEY NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_summer_end_dates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "travel_buffer_overrides" (
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"buffer_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_buffer_overrides_from_location_id_to_location_id_pk" PRIMARY KEY("from_location_id","to_location_id"),
	CONSTRAINT "travel_buffer_no_self_loop" CHECK ("travel_buffer_overrides"."from_location_id" <> "travel_buffer_overrides"."to_location_id")
);
--> statement-breakpoint
ALTER TABLE "travel_buffer_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_locations" ADD CONSTRAINT "lesson_locations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_buffer_overrides" ADD CONSTRAINT "travel_buffer_overrides_from_location_id_lesson_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."lesson_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_buffer_overrides" ADD CONSTRAINT "travel_buffer_overrides_to_location_id_lesson_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."lesson_locations"("id") ON DELETE cascade ON UPDATE no action;