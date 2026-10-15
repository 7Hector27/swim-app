CREATE TYPE "public"."coach_note_type" AS ENUM('observation', 'correction', 'drill', 'recommendation');--> statement-breakpoint
ALTER TABLE "coach_notes" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD COLUMN "note_type" "coach_note_type" DEFAULT 'observation' NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;