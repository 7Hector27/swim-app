ALTER TABLE "lessons" DROP CONSTRAINT "lessons_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_location_id_lesson_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "household_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "requested_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_location_id_lesson_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."lesson_locations"("id") ON DELETE set null ON UPDATE no action;