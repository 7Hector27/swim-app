CREATE TABLE "cron_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"held_until" timestamp with time zone,
	"held_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cron_leases" ENABLE ROW LEVEL SECURITY;