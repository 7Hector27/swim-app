ALTER TABLE "availability_config" ADD COLUMN "default_teaches_days" integer[] DEFAULT '{2,3,4,5}' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_config" ADD COLUMN "default_start_time" time DEFAULT '16:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_config" ADD COLUMN "default_end_time" time DEFAULT '20:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_config" ADD CONSTRAINT "availability_config_default_start_before_end" CHECK ("availability_config"."default_start_time" < "availability_config"."default_end_time");