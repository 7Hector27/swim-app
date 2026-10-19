-- Custom SQL migration file, put your code below! --
UPDATE availability_seasons AS s
SET end_date = COALESCE(
  (SELECT (next_s.start_date::date - INTERVAL '1 day')::date
   FROM availability_seasons AS next_s
   WHERE next_s.start_date > s.start_date
   ORDER BY next_s.start_date ASC LIMIT 1),
  (s.start_date::date + INTERVAL '3 months')::date
);

ALTER TABLE "availability_seasons" ALTER COLUMN "end_date" SET NOT NULL;
ALTER TABLE "availability_seasons" ADD CONSTRAINT "availability_seasons_end_after_start" CHECK ("availability_seasons"."end_date" >= "availability_seasons"."start_date");
