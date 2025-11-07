--
-- Align auth metadata roles with user_roles during signup so therapists do not default to clients.
-- This migration introduces a trigger that inspects the raw user metadata for each new
-- auth.user and assigns the matching application role (currently therapist or client).
-- It also backfills existing accounts where metadata indicates a therapist or client role
-- but no user_roles row has been recorded.
--

BEGIN;

CREATE OR REPLACE FUNCTION app.resolve_signup_role(p_metadata jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_role text := lower(COALESCE(v_metadata->>'role', v_metadata->>'signup_role', ''));
  v_guardian boolean := COALESCE((v_metadata->>'guardian_signup')::boolean, false);
BEGIN
  IF v_role IS NULL OR v_role = '' THEN
    RETURN NULL;
  END IF;

  IF v_guardian OR v_role = 'guardian' THEN
    RETURN 'client';
  END IF;

  IF v_role IN ('client', 'therapist') THEN
    RETURN v_role;
  END IF;

  RETURN NULL;
END;
$$;

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
      granted_by = NEW.id,
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

CREATE OR REPLACE FUNCTION public.block_role_change_non_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_bypass text := current_setting('app.bypass_profile_role_guard', true);
BEGIN
  IF v_bypass IS NOT NULL AND lower(v_bypass) IN ('on', 'true', '1') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden: only admin may change role';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_signup_role_trigger ON auth.users;
CREATE TRIGGER apply_signup_role_trigger
  BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION app.apply_signup_role();

SELECT set_config('app.bypass_profile_role_guard', 'on', true);

WITH candidate_users AS (
  SELECT
    u.id,
    app.resolve_signup_role(u.raw_user_meta_data) AS target_role
  FROM auth.users u
)
INSERT INTO public.user_roles (user_id, role_id, granted_by, granted_at, is_active)
SELECT
  cu.id,
  r.id,
  cu.id,
  timezone('utc', now()),
  true
FROM candidate_users cu
JOIN public.roles r ON r.name = cu.target_role
WHERE cu.target_role IS NOT NULL
ON CONFLICT (user_id, role_id)
DO UPDATE SET
  is_active = true,
  granted_by = EXCLUDED.granted_by,
  granted_at = EXCLUDED.granted_at,
  expires_at = NULL;

SELECT set_config('app.bypass_profile_role_guard', 'off', true);

COMMIT;

