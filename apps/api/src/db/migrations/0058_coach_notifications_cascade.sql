ALTER TABLE "coach_notifications" DROP CONSTRAINT "coach_notifications_lesson_id_lessons_id_fk";
--> statement-breakpoint
ALTER TABLE "coach_notifications" DROP CONSTRAINT "coach_notifications_batch_id_booking_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_batch_id_booking_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."booking_batches"("id") ON DELETE cascade ON UPDATE no action;