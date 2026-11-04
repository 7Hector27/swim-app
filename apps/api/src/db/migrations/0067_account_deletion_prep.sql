CREATE TABLE "account_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"auth_user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_jobs_scope_valid" CHECK ("account_deletion_jobs"."scope" IN ('solo', 'leave')),
	CONSTRAINT "account_deletion_jobs_status_valid" CHECK ("account_deletion_jobs"."status" IN ('pending', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "account_deletion_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "location_snapshot" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "swimmer_count" integer;--> statement-breakpoint
CREATE INDEX "account_deletion_jobs_pending_idx" ON "account_deletion_jobs" USING btree ("updated_at") WHERE status = 'pending';