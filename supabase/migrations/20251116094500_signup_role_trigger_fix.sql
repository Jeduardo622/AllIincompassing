--
-- Adjust signup role trigger to run after auth.users inserts so granted_by references are valid.
--

BEGIN;

CREATE OR REPLACE FUNCTION app.apply_signup_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_metadata jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_target_role text := app.resolve_signup_role(v_metadata);
  v_role_id uuid;
BEGIN
  IF v_target_role IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE name = v_target_role;

  IF v_role_id IS NULL THEN
    RAISE WARNING 'apply_signup_role: role % not found for user %', v_target_role, NEW.id;
    RETURN NEW;
  END IF;

  PERFORM set_config('app.bypass_profile_role_guard', 'on', true);

  BEGIN
    INSERT INTO public.user_roles (user_id, role_id, granted_by, granted_at, is_active)
    VALUES (NEW.id, v_role_id, NEW.id, timezone('utc', now()), true)
    ON CONFLICT (user_id, role_id)
    DO UPDATE SET
      is_active = true,
      granted_by = COALESCE(EXCLUDED.granted_by, user_roles.granted_by),
      granted_at = timezone('utc', now()),
      expires_at = NULL;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('app.bypass_profile_role_guard', 'off', true);
      RAISE;
  END;

  PERFORM set_config('app.bypass_profile_role_guard', 'off', true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_signup_role_trigger ON auth.users;
CREATE TRIGGER apply_signup_role_trigger
  AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION app.apply_signup_role();

COMMIT;

