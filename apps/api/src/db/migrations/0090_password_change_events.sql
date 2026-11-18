CREATE TYPE "public"."password_change_method" AS ENUM('reset', 'change');--> statement-breakpoint
CREATE TABLE "password_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"method" "password_change_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_change_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_change_events" ADD CONSTRAINT "password_change_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_change_events_profile_created_idx" ON "password_change_events" USING btree ("profile_id","created_at" DESC NULLS LAST);