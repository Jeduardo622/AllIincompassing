-- Fix auth admin seed flows.
-- 1) Harden assign_role_on_signup to avoid ambiguous role_id handling.

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_role_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  user_role_name text := 'client';
  v_role_id uuid;
BEGIN
  CASE NEW.email
    WHEN 'admin@test.com' THEN user_role_name := 'admin';
    WHEN 'superadmin@test.com' THEN user_role_name := 'super_admin';
    WHEN 'therapist@test.com' THEN user_role_name := 'therapist';
    WHEN 'j_eduardo622@yahoo.com' THEN user_role_name := 'admin';
    ELSE user_role_name := 'client';
  END CASE;

  SELECT id INTO v_role_id
  FROM public.roles
  WHERE name = user_role_name;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, v_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
