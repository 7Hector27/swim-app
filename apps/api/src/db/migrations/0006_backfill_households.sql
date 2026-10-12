DO $$
DECLARE
  rec RECORD;
  multi_count INTEGER;
  household_uuid UUID;
  household_name TEXT;
  last_word TEXT;
BEGIN
  -- Assert no swimmer has more than one guardian.
  SELECT COUNT(*) INTO multi_count
  FROM (
    SELECT swimmer_id FROM guardians GROUP BY swimmer_id HAVING COUNT(*) > 1
  ) sub;
  IF multi_count > 0 THEN
    RAISE EXCEPTION 'Found % swimmer(s) with multiple guardians. Reset your local DB: pnpm db:down && pnpm db:up && pnpm db:migrate', multi_count;
  END IF;

  -- For each distinct profile in guardians, create a household and backfill.
  FOR rec IN
    SELECT DISTINCT g.profile_id, p.full_name
    FROM guardians g
    LEFT JOIN profiles p ON p.id = g.profile_id
  LOOP
    -- Derive household name from last word of full_name.
    IF rec.full_name IS NULL OR trim(rec.full_name) = '' THEN
      household_name := 'My household';
    ELSE
      last_word := trim(split_part(trim(rec.full_name), ' ', -1));
      IF last_word = '' THEN
        household_name := 'My household';
      ELSE
        household_name := last_word || ' household';
      END IF;
    END IF;

    INSERT INTO households (name) VALUES (household_name) RETURNING id INTO household_uuid;

    INSERT INTO household_members (household_id, profile_id, role)
    VALUES (household_uuid, rec.profile_id, 'owner');

    UPDATE swimmers
    SET household_id = household_uuid
    WHERE id IN (SELECT swimmer_id FROM guardians WHERE profile_id = rec.profile_id);

    INSERT INTO household_audit_log (household_id, actor_id, action, target_swimmer_id)
    SELECT household_uuid, rec.profile_id, 'swimmer_added', swimmer_id
    FROM guardians
    WHERE profile_id = rec.profile_id;
  END LOOP;

  -- Assert every swimmer has a household_id set.
  IF EXISTS (SELECT 1 FROM swimmers WHERE household_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: some swimmers still have null household_id';
  END IF;

  -- Set NOT NULL now that all rows are backfilled.
  ALTER TABLE swimmers ALTER COLUMN household_id SET NOT NULL;

  -- Drop the guardians table.
  DROP TABLE guardians;
END $$;
