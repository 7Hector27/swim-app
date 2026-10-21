CREATE TABLE "coach_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_profile_id" uuid,
	"target_swimmer_id" uuid,
	"new_role" "household_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coach_calendar_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_profile_id" uuid NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"google_calendar_id" text NOT NULL,
	"google_account_email" text NOT NULL,
	"scope" text NOT NULL,
	"refresh_token_ciphertext" "bytea" NOT NULL,
	"refresh_token_iv" "bytea" NOT NULL,
	"refresh_token_tag" "bytea" NOT NULL,
	"refresh_token_key_version" integer DEFAULT 1 NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_attempted_at" timestamp with time zone,
	"last_sync_succeeded_at" timestamp with time zone,
	"needs_reconnect_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_calendar_integrations_status_valid" CHECK ("coach_calendar_integrations"."status" IN ('active', 'needs_reconnect'))
);
--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coach_audit_log" ADD CONSTRAINT "coach_audit_log_coach_id_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_audit_log" ADD CONSTRAINT "coach_audit_log_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_audit_log" ADD CONSTRAINT "coach_audit_log_target_profile_id_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_audit_log" ADD CONSTRAINT "coach_audit_log_target_swimmer_id_swimmers_id_fk" FOREIGN KEY ("target_swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ADD CONSTRAINT "coach_calendar_integrations_coach_profile_id_profiles_id_fk" FOREIGN KEY ("coach_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_audit_log_coach_created_idx" ON "coach_audit_log" USING btree ("coach_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "coach_calendar_integrations_coach_profile_uniq" ON "coach_calendar_integrations" USING btree ("coach_profile_id");