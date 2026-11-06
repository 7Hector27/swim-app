ALTER TABLE "coach_notifications" DROP CONSTRAINT "coach_notifications_category_valid";--> statement-breakpoint
ALTER TABLE "coach_notifications" DROP CONSTRAINT "coach_notifications_scope_valid";--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_category_valid" CHECK ("coach_notifications"."category" IN ('booking_request', 'request_expiring_soon', 'parent_change', 'calendar_disconnected', 'auto_approved_summary', 'daily_summary', 'account_deleted'));--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_scope_valid" CHECK ((
        ("coach_notifications"."category" IN ('booking_request', 'request_expiring_soon', 'parent_change', 'auto_approved_summary')
         AND ((CASE WHEN "coach_notifications"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
            + (CASE WHEN "coach_notifications"."batch_id" IS NOT NULL THEN 1 ELSE 0 END) = 1))
        OR ("coach_notifications"."category" IN ('calendar_disconnected', 'daily_summary', 'account_deleted')
            AND "coach_notifications"."lesson_id" IS NULL AND "coach_notifications"."batch_id" IS NULL)
      ));