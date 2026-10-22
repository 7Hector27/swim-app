-- Mirror auth.users.email and auth.users.email_confirmed_at onto profiles so
-- the API runtime can resolve recipient emails + verification state without
-- the service-role key. See ADR 028.
--
-- The trigger function is SECURITY DEFINER with an empty search_path, so
-- every table reference must be fully qualified.

-- 1. Replace handle_new_user to populate the mirror on first insert.
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

  IF v_full_name IS NULL OR trim(v_full_name) = '' THEN
    v_hh_name := 'My household';
  ELSE
    v_last_word := regexp_replace(trim(v_full_name), '^.*\s', '');
    v_hh_name   := v_last_word || ' household';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, email_verified_at)
  VALUES (new.id, v_full_name, new.email, new.email_confirmed_at);

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

-- 2. Add the update trigger. Fires only when the two mirrored fields change,
--    so unrelated auth.users updates don't thrash the profiles row.
CREATE OR REPLACE FUNCTION public.handle_user_email_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET email = new.email,
      email_verified_at = new.email_confirmed_at
  WHERE id = new.id;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (new.email IS DISTINCT FROM old.email
        OR new.email_confirmed_at IS DISTINCT FROM old.email_confirmed_at)
  EXECUTE PROCEDURE public.handle_user_email_update();

-- 3. One-time backfill of the mirror for every existing profile.
UPDATE public.profiles p
SET email = u.email,
    email_verified_at = u.email_confirmed_at
FROM auth.users u
WHERE u.id = p.id
  AND (p.email IS DISTINCT FROM u.email
       OR p.email_verified_at IS DISTINCT FROM u.email_confirmed_at);
