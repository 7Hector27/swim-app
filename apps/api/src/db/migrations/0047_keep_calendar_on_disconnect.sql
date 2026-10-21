ALTER TABLE "coach_calendar_integrations" DROP CONSTRAINT "coach_calendar_integrations_status_valid";--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ALTER COLUMN "scope" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ALTER COLUMN "refresh_token_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ALTER COLUMN "refresh_token_iv" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ALTER COLUMN "refresh_token_tag" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ALTER COLUMN "refresh_token_key_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ALTER COLUMN "refresh_token_key_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_calendar_integrations" ADD CONSTRAINT "coach_calendar_integrations_status_valid" CHECK ("coach_calendar_integrations"."status" IN ('active', 'needs_reconnect', 'disconnected'));