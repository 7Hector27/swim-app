-- Replace the placeholder clubs with Jason's list of local Orange County teams.
-- Inserts are idempotent on `name`; placeholder clubs (`[Club 1]`, `[Club 2]`, …)
-- are deactivated rather than deleted in case a test swimmer still references one.

INSERT INTO "clubs" ("name") VALUES
  ('Anaheim Aquatics Association'),
  ('Aquazot Swim Club (AZOT)'),
  ('Brea Aquatics'),
  ('Brea Glenbrook Swim Team'),
  ('CTI Aquatics'),
  ('Coastal Machine Aquatics Club (CMAC)'),
  ('Coto Coyotes'),
  ('Dolphin Aquatics'),
  ('East Lake Eagle Rays'),
  ('Elite Aquatics Sports Team'),
  ('Evolution Racing Club'),
  ('Fullerton Aquatics Sports Team (FAST)'),
  ('Garden Grove Aquatics'),
  ('Golden West Swim Club'),
  ('Irvine Novaquatics (NOVA)'),
  ('JCC Waves'),
  ('Life Time Swim Southern California'),
  ('Mission Viejo Nadadores (MVN)'),
  ('Newport Beach Swimming'),
  ('OC Riptide Aquatics'),
  ('Orange County Gold'),
  ('Patriot Swim Club'),
  ('San Clemente Aquatics'),
  ('Seal Beach Swim Club'),
  ('SoCal Aquatics Association'),
  ('South Orange County Aquatics'),
  ('Speed Aquatics'),
  ('Splash Aquatics'),
  ('Swim Team of Placentia'),
  ('SwimNation Aquatics (SNAP!)'),
  ('The Swim Team (TST)'),
  ('Tustin Dolphins'),
  ('Waterworks Aquatics Swim Club'),
  ('Woodbridge Wahoos'),
  ('YMCA of Orange County')
ON CONFLICT ("name") DO NOTHING;

UPDATE "clubs" SET "is_active" = false WHERE "name" LIKE '[Club %]';
