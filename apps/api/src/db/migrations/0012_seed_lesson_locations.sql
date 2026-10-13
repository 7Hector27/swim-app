INSERT INTO lesson_locations (id, name, address, city, state, zip, household_id, is_active, sort_order)
VALUES
  (gen_random_uuid(), 'Egret Park', '45 Ovation', 'Irvine', 'CA', '92620', NULL, true, 1),
  (gen_random_uuid(), 'Swallows Park', '60 Lawnwood', 'Irvine', 'CA', '92620', NULL, true, 2),
  (gen_random_uuid(), 'The Commons Park', '46 Passage', 'Irvine', 'CA', '92603', NULL, true, 3);