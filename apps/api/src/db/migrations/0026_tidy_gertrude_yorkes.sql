CREATE TYPE "public"."standard_name" AS ENUM('B', 'BB', 'A', 'AA', 'AAA', 'AAAA');--> statement-breakpoint
CREATE TABLE "motivational_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"standard_name" "standard_name" NOT NULL,
	"event_distance" integer NOT NULL,
	"event_stroke" "swim_stroke" NOT NULL,
	"course" "course" NOT NULL,
	"sex" "sex" NOT NULL,
	"age_group" text NOT NULL,
	"cut_time_hundredths" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cut_time_positive" CHECK ("motivational_standards"."cut_time_hundredths" > 0)
);
--> statement-breakpoint
ALTER TABLE "motivational_standards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "motivational_standards_uniq" ON "motivational_standards" USING btree ("standard_name","event_distance","event_stroke","course","sex","age_group");