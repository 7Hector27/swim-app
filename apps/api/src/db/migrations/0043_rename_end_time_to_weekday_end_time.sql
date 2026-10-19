ALTER TABLE "availability_seasons" RENAME COLUMN "end_time" TO "weekday_end_time";
ALTER TABLE "availability_seasons" DROP CONSTRAINT "availability_seasons_weekday_before_end";
ALTER TABLE "availability_seasons" ADD CONSTRAINT "availability_seasons_weekday_before_end" CHECK (weekday_start_time IS NULL OR weekday_end_time IS NULL OR weekday_start_time < weekday_end_time);