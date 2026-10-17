DROP TABLE "season_summer_end_dates" CASCADE;--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "lesson_days";--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "school_year_start_time";--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "school_year_end_time";--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "summer_morning_start_time";--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "summer_morning_end_time";--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "summer_evening_start_time";--> statement-breakpoint
ALTER TABLE "availability_config" DROP COLUMN "summer_evening_end_time";