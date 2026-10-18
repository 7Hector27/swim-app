CREATE TYPE "public"."availability_override_kind" AS ENUM('day_off', 'custom_hours');--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "availability_override_kind" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_overrides_end_on_or_after_start" CHECK ("availability_overrides"."end_date" >= "availability_overrides"."start_date"),
	CONSTRAINT "availability_overrides_kind_shape" CHECK (("availability_overrides"."kind" = 'day_off'
            AND "availability_overrides"."start_time" IS NULL
            AND "availability_overrides"."end_time" IS NULL)
          OR ("availability_overrides"."kind" = 'custom_hours'
            AND "availability_overrides"."start_time" IS NOT NULL
            AND "availability_overrides"."end_time" IS NOT NULL
            AND "availability_overrides"."start_date" = "availability_overrides"."end_date"
            AND "availability_overrides"."start_time" < "availability_overrides"."end_time"))
);
--> statement-breakpoint
ALTER TABLE "availability_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "availability_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"teaches_days" integer[] NOT NULL,
	"weekday_start_time" time,
	"weekend_start_time" time,
	"end_time" time NOT NULL,
	"starts_at_dst" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_seasons_start_date_unique" UNIQUE("start_date"),
	CONSTRAINT "availability_seasons_weekday_before_end" CHECK ("availability_seasons"."weekday_start_time" IS NULL OR "availability_seasons"."weekday_start_time" < "availability_seasons"."end_time"),
	CONSTRAINT "availability_seasons_weekend_before_end" CHECK ("availability_seasons"."weekend_start_time" IS NULL OR "availability_seasons"."weekend_start_time" < "availability_seasons"."end_time")
);
--> statement-breakpoint
ALTER TABLE "availability_seasons" ENABLE ROW LEVEL SECURITY;