-- @migration-intent: Prevent self-service profile edits from mutating tenant scope or privilege fields used by authorization checks.
-- @migration-dependencies: 20260313120000_onboarding_authz_and_prefill_retention_hardening.sql
-- @migration-rollback: Re-grant app.resolve_user_organization_id(uuid) to authenticated and drop app.enforce_profile_authz_field_immutability trigger/function.

BEGIN;

REVOKE EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) FROM public;
GRANT EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) TO service_role;

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

DROP TRIGGER IF EXISTS enforce_profile_authz_field_immutability ON public.profiles;
CREATE TRIGGER enforce_profile_authz_field_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_profile_authz_field_immutability();

COMMIT;
