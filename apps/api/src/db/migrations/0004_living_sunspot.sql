CREATE TYPE "public"."league" AS ENUM('club', 'summer_league');--> statement-breakpoint
CREATE TABLE "league_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"league" "league" NOT NULL,
	"season_start_year" integer NOT NULL,
	"registered_on" date NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "league_registrations" ADD CONSTRAINT "league_registrations_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "league_registrations_swimmer_league_season_uniq" ON "league_registrations" USING btree ("swimmer_id","league","season_start_year");