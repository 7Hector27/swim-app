ALTER TABLE "coach_notifications" DROP CONSTRAINT "coach_notifications_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;