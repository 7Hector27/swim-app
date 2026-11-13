CREATE TYPE "public"."balance_entry_type" AS ENUM('card_topup', 'package_purchase', 'package_bonus', 'lesson_charge', 'refund_to_balance', 'coach_adjustment', 'free_lesson');--> statement-breakpoint
CREATE TABLE "household_balance_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"entry_type" "balance_entry_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"lesson_id" uuid,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_ledger_amount_sign_valid" CHECK ((
        ("household_balance_ledger"."entry_type" IN ('card_topup', 'package_purchase', 'package_bonus', 'refund_to_balance') AND "household_balance_ledger"."amount_cents" > 0)
        OR ("household_balance_ledger"."entry_type" = 'lesson_charge' AND "household_balance_ledger"."amount_cents" < 0)
        OR ("household_balance_ledger"."entry_type" = 'free_lesson' AND "household_balance_ledger"."amount_cents" = 0)
        OR ("household_balance_ledger"."entry_type" = 'coach_adjustment' AND "household_balance_ledger"."amount_cents" <> 0)
      )),
	CONSTRAINT "balance_ledger_lesson_id_scope_valid" CHECK ((
        ("household_balance_ledger"."entry_type" IN ('lesson_charge', 'refund_to_balance', 'free_lesson') AND "household_balance_ledger"."lesson_id" IS NOT NULL)
        OR ("household_balance_ledger"."entry_type" NOT IN ('lesson_charge', 'refund_to_balance', 'free_lesson') AND "household_balance_ledger"."lesson_id" IS NULL)
      )),
	CONSTRAINT "balance_ledger_stripe_session_scope_valid" CHECK ((
        ("household_balance_ledger"."entry_type" IN ('card_topup', 'package_purchase', 'package_bonus') AND "household_balance_ledger"."stripe_checkout_session_id" IS NOT NULL)
        OR ("household_balance_ledger"."entry_type" NOT IN ('card_topup', 'package_purchase', 'package_bonus') AND "household_balance_ledger"."stripe_checkout_session_id" IS NULL)
      )),
	CONSTRAINT "balance_ledger_adjustment_reason_valid" CHECK ((
        ("household_balance_ledger"."entry_type" = 'coach_adjustment' AND "household_balance_ledger"."reason" IS NOT NULL AND length(trim("household_balance_ledger"."reason")) > 0)
        OR ("household_balance_ledger"."entry_type" <> 'coach_adjustment' AND "household_balance_ledger"."reason" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"stripe_event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"stripe_checkout_session_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "household_balance_ledger_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "household_balance_ledger_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "household_balance_ledger_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_ledger_household_created_idx" ON "household_balance_ledger" USING btree ("household_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "balance_ledger_lesson_idx" ON "household_balance_ledger" USING btree ("lesson_id") WHERE lesson_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "balance_ledger_stripe_session_uq" ON "household_balance_ledger" USING btree ("stripe_checkout_session_id") WHERE entry_type IN ('card_topup', 'package_purchase');