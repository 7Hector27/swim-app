CREATE TABLE "coach_notification_preferences" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"booking_request_enabled" boolean DEFAULT true NOT NULL,
	"booking_request_email_backup_enabled" boolean DEFAULT true NOT NULL,
	"request_expiring_soon_enabled" boolean DEFAULT true NOT NULL,
	"parent_change_enabled" boolean DEFAULT true NOT NULL,
	"auto_approved_mode" text DEFAULT 'summary' NOT NULL,
	"daily_summary_enabled" boolean DEFAULT true NOT NULL,
	"daily_summary_time_local" time DEFAULT '08:00' NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_start_local" time DEFAULT '21:00' NOT NULL,
	"quiet_hours_end_local" time DEFAULT '07:00' NOT NULL,
	"lock_screen_detail" text DEFAULT 'first_initial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_notification_preferences_auto_approved_mode_valid" CHECK ("coach_notification_preferences"."auto_approved_mode" IN ('off', 'summary', 'immediate')),
	CONSTRAINT "coach_notification_preferences_lock_screen_detail_valid" CHECK ("coach_notification_preferences"."lock_screen_detail" IN ('first_initial', 'full_name'))
);
--> statement-breakpoint
ALTER TABLE "coach_notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coach_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"category" text NOT NULL,
	"urgency" text NOT NULL,
	"lesson_id" uuid,
	"batch_id" uuid,
	"payload" jsonb NOT NULL,
	"click_url" text NOT NULL,
	"tag" text NOT NULL,
	"read_at" timestamp with time zone,
	"push_status" text DEFAULT 'pending' NOT NULL,
	"release_at" timestamp with time zone,
	"push_attempts" integer DEFAULT 0 NOT NULL,
	"push_claimed_until" timestamp with time zone,
	"push_last_error" text,
	"push_last_attempt_at" timestamp with time zone,
	"push_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"push_sent_at" timestamp with time zone,
	"delivered_subscription_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_notifications_category_valid" CHECK ("coach_notifications"."category" IN ('booking_request', 'request_expiring_soon', 'parent_change', 'calendar_disconnected', 'auto_approved_summary', 'daily_summary')),
	CONSTRAINT "coach_notifications_urgency_valid" CHECK ("coach_notifications"."urgency" IN ('standard', 'urgent')),
	CONSTRAINT "coach_notifications_push_status_valid" CHECK ("coach_notifications"."push_status" IN ('pending', 'held', 'summarized', 'sending', 'sent', 'failed', 'skipped', 'superseded', 'abandoned')),
	CONSTRAINT "coach_notifications_claim_pair" CHECK (("coach_notifications"."push_status" = 'sending') = ("coach_notifications"."push_claimed_until" IS NOT NULL)),
	CONSTRAINT "coach_notifications_held_pair" CHECK (("coach_notifications"."push_status" = 'held') = ("coach_notifications"."release_at" IS NOT NULL)),
	CONSTRAINT "coach_notifications_scope_valid" CHECK ((
        ("coach_notifications"."category" IN ('booking_request', 'request_expiring_soon', 'parent_change', 'auto_approved_summary')
         AND ((CASE WHEN "coach_notifications"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
            + (CASE WHEN "coach_notifications"."batch_id" IS NOT NULL THEN 1 ELSE 0 END) = 1))
        OR ("coach_notifications"."category" IN ('calendar_disconnected', 'daily_summary')
            AND "coach_notifications"."lesson_id" IS NULL AND "coach_notifications"."batch_id" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "coach_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coach_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"removed_reason" text,
	"last_delivery_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_push_subscriptions_profile_endpoint_uq" UNIQUE("profile_id","endpoint"),
	CONSTRAINT "coach_push_subscriptions_removed_reason_valid" CHECK ("coach_push_subscriptions"."removed_reason" IS NULL OR "coach_push_subscriptions"."removed_reason" IN ('gone', 'coach_disabled')),
	CONSTRAINT "coach_push_subscriptions_removed_reason_pair" CHECK (("coach_push_subscriptions"."is_active" = true AND "coach_push_subscriptions"."removed_reason" IS NULL)
        OR ("coach_push_subscriptions"."is_active" = false))
);
--> statement-breakpoint
ALTER TABLE "coach_push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_event_valid";--> statement-breakpoint
ALTER TABLE "coach_notification_preferences" ADD CONSTRAINT "coach_notification_preferences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_batch_id_booking_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."booking_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_push_subscriptions" ADD CONSTRAINT "coach_push_subscriptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_notifications_lesson_category_uq" ON "coach_notifications" USING btree ("profile_id","lesson_id","category") WHERE lesson_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_notifications_batch_category_uq" ON "coach_notifications" USING btree ("profile_id","batch_id","category") WHERE batch_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_notifications_daily_summary_uq" ON "coach_notifications" USING btree ("profile_id",(payload->>'dateLocal')) WHERE category = 'daily_summary';--> statement-breakpoint
CREATE INDEX "coach_notifications_drain_idx" ON "coach_notifications" USING btree ("push_next_attempt_at") WHERE push_status IN ('pending', 'failed', 'sending');--> statement-breakpoint
CREATE INDEX "coach_notifications_release_idx" ON "coach_notifications" USING btree ("release_at") WHERE push_status = 'held';--> statement-breakpoint
CREATE INDEX "coach_notifications_list_idx" ON "coach_notifications" USING btree ("profile_id",read_at NULLS FIRST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coach_notifications_profile_created_idx" ON "coach_notifications" USING btree ("profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coach_push_subscriptions_profile_active_idx" ON "coach_push_subscriptions" USING btree ("profile_id","is_active");--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_event_valid" CHECK ("lesson_email_outbox"."event" IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled', 'batch_booked', 'batch_approved', 'batch_canceled', 'coach_booking_request'));