-- @migration-intent: Let trusted sync paths (sync_user_profile / sync_profile_role) mutate role/org when app.bypass_profile_role_guard is on.
-- @migration-dependencies: 20260313123000_profiles_org_immutability_guard.sql
-- @migration-rollback: Restore app.enforce_profile_authz_field_immutability from 20260313123000_profiles_org_immutability_guard.sql.

BEGIN;

CREATE OR REPLACE FUNCTION app.enforce_profile_authz_field_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
  is_service_role boolean := COALESCE(jwt_role, '') = 'service_role';
  is_super_admin boolean := app.current_user_is_super_admin();
BEGIN
  IF COALESCE(current_setting('app.bypass_profile_role_guard', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF is_service_role THEN
    RETURN NEW;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND NOT is_super_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'organization_id is immutable for this role';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_super_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'role is immutable for this role';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT is_super_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'is_active is immutable for this role';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
