-- @migration-intent: Prevent self-service profile inserts from setting tenant or privilege-bearing fields.
-- @migration-dependencies: 20260313123000_profiles_org_immutability_guard.sql
-- @migration-rollback: Restore previous profiles_insert_self_client policy definition and remove insert authz guard trigger/function.

BEGIN;

DROP POLICY IF EXISTS profiles_insert_self_client ON public.profiles;
CREATE POLICY profiles_insert_self_client
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    id = (select auth.uid())
    AND (role)::text = 'client'
    AND organization_id IS NULL
    AND COALESCE(is_active, true) = true
  );

CREATE OR REPLACE FUNCTION app.normalize_profile_insert_authz_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
  is_service_role boolean := COALESCE(jwt_role, '') = 'service_role';
BEGIN
  IF is_service_role OR app.current_user_is_super_admin() THEN
    RETURN NEW;
  END IF;

  NEW.role := 'client'::role_type;
  NEW.organization_id := NULL;
  NEW.is_active := COALESCE(NEW.is_active, true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_profile_insert_authz_fields ON public.profiles;
CREATE TRIGGER normalize_profile_insert_authz_fields
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION app.normalize_profile_insert_authz_fields();

COMMIT;
