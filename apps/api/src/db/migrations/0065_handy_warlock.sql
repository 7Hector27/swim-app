ALTER TABLE "bulk_cancellations" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "bulk_cancellations" ADD COLUMN "end_time" time;--> statement-breakpoint
ALTER TABLE "bulk_cancellations" ADD CONSTRAINT "bulk_cancellations_time_window_pair" CHECK (("bulk_cancellations"."start_time" IS NULL) = ("bulk_cancellations"."end_time" IS NULL));--> statement-breakpoint
ALTER TABLE "bulk_cancellations" ADD CONSTRAINT "bulk_cancellations_end_after_start_time" CHECK ("bulk_cancellations"."start_time" IS NULL OR "bulk_cancellations"."end_time" > "bulk_cancellations"."start_time");