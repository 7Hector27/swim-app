-- Replace the trigger function to create profile + household + owner membership
-- + audit log entry atomically on every new auth.users row.
--
-- SECURITY DEFINER + empty search_path requires fully-qualified table names.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_full_name  text;
  v_last_word  text;
  v_hh_name    text;
  v_hh_id      uuid;
BEGIN
  v_full_name := new.raw_user_meta_data ->> 'full_name';

  -- Derive household name from the last whitespace-delimited word of full_name.
  -- regexp_replace with '^.*\s' strips everything up to and including the final
  -- space; if there is no space (single-word name) the pattern does not match
  -- and the full name is used as-is.
  IF v_full_name IS NULL OR trim(v_full_name) = '' THEN
    v_hh_name := 'My household';
  ELSE
    v_last_word := regexp_replace(trim(v_full_name), '^.*\s', '');
    v_hh_name   := v_last_word || ' household';
  END IF;

  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, v_full_name);

  INSERT INTO public.households (name)
  VALUES (v_hh_name)
  RETURNING id INTO v_hh_id;

  INSERT INTO public.household_members (household_id, profile_id, role)
  VALUES (v_hh_id, new.id, 'owner');

  INSERT INTO public.household_audit_log (household_id, actor_id, action)
  VALUES (v_hh_id, new.id, 'household_created');

  RETURN new;
END;
$$;

-- Enforce exactly one owner per household.
CREATE UNIQUE INDEX IF NOT EXISTS household_members_one_owner_uniq
  ON public.household_members (household_id)
  WHERE role = 'owner';
