-- ADR 030 phase 2: replace aligned weekday + time arrays on booking_batches
-- with a single `weekly_pattern` jsonb column holding
-- [{ weekday, timeOfDay, durationMinutes }]. The shared BatchPatternPairSchema
-- validates the shape on write (via POST /lessons/batch) and on read via
-- mapBookingBatchRow(). Pre-existing weekly rows are backfilled from the two
-- old arrays, using one of their member lessons' duration_minutes as the
-- per-entry length (the pre-change world had one length per batch so every
-- member lesson shares it; 30 is a safe default if the batch has no members).
--> statement-breakpoint
ALTER TABLE "booking_batches" DROP CONSTRAINT IF EXISTS "booking_batches_weekly_fields_pair";--> statement-breakpoint
ALTER TABLE "booking_batches" ADD COLUMN "weekly_pattern" jsonb;--> statement-breakpoint
UPDATE "booking_batches" AS b
SET "weekly_pattern" = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'weekday', wd,
      'timeOfDay', to_char(t, 'HH24:MI'),
      'durationMinutes', COALESCE(
        (SELECT l.duration_minutes
           FROM "lessons" l
           WHERE l.batch_id = b.id
           ORDER BY l.starts_at
           LIMIT 1),
        30
      )
    ) ORDER BY ord
  )
  FROM unnest(b."weekly_pattern_weekdays", b."weekly_pattern_times")
       WITH ORDINALITY AS u(wd, t, ord)
)
WHERE b.mode = 'weekly';--> statement-breakpoint
ALTER TABLE "booking_batches" DROP COLUMN "weekly_pattern_weekdays";--> statement-breakpoint
ALTER TABLE "booking_batches" DROP COLUMN "weekly_pattern_times";--> statement-breakpoint
ALTER TABLE "booking_batches" ADD CONSTRAINT "booking_batches_weekly_fields_pair" CHECK ((
  ("booking_batches"."mode" = 'weekly'
   AND "booking_batches"."weekly_pattern" IS NOT NULL
   AND jsonb_typeof("booking_batches"."weekly_pattern") = 'array'
   AND jsonb_array_length("booking_batches"."weekly_pattern") >= 1
   AND "booking_batches"."weekly_start_date" IS NOT NULL
   AND "booking_batches"."weekly_weeks" IS NOT NULL)
  OR
  ("booking_batches"."mode" = 'manual'
   AND "booking_batches"."weekly_pattern" IS NULL
   AND "booking_batches"."weekly_start_date" IS NULL
   AND "booking_batches"."weekly_weeks" IS NULL)
));
