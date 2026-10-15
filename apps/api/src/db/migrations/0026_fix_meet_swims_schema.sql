-- Custom SQL migration file, put your code below! --

-- Drop the old time_seconds column and add time_hundredths as integer
ALTER TABLE "meet_swims" DROP COLUMN "time_seconds";
ALTER TABLE "meet_swims" ADD COLUMN "time_hundredths" integer NOT NULL DEFAULT 0;
ALTER TABLE "meet_swims" ALTER COLUMN "time_hundredths" DROP DEFAULT;

-- Add course column
ALTER TABLE "meet_swims" ADD COLUMN "course" "course" NOT NULL DEFAULT 'scy';
ALTER TABLE "meet_swims" ALTER COLUMN "course" DROP DEFAULT;

-- Add created_by column with FK to profiles
ALTER TABLE "meet_swims" ADD COLUMN "created_by" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE "meet_swims" ALTER COLUMN "created_by" DROP DEFAULT;
ALTER TABLE "meet_swims" ADD CONSTRAINT "meet_swims_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
