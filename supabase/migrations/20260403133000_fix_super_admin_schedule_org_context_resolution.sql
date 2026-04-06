-- @migration-intent: Align super admin org resolution with explicit impersonation context used by schedule RPCs.
-- @migration-dependencies: 20260313120000_onboarding_authz_and_prefill_retention_hardening.sql
-- @migration-rollback: Restore app.resolve_user_organization_id(uuid) definition and grant posture from 20260313120000 + 20260313123000.

BEGIN;

CREATE OR REPLACE FUNCTION app.resolve_user_organization_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.organization_id
  INTO resolved_org
  FROM public.profiles p
  WHERE p.id = p_user_id
  LIMIT 1;

  IF resolved_org IS NOT NULL THEN
    RETURN resolved_org;
  END IF;

  SELECT t.organization_id
  INTO resolved_org
  FROM public.therapists t
  WHERE t.id = p_user_id
  LIMIT 1;

  IF resolved_org IS NOT NULL THEN
    RETURN resolved_org;
  END IF;

  SELECT c.organization_id
  INTO resolved_org
  FROM public.clients c
  WHERE c.id = p_user_id
  LIMIT 1;

  -- Super admins can scope themselves to a tenant via explicit metadata/preferences
  -- even when their profile organization_id remains null.
  IF resolved_org IS NULL
     AND p_user_id = auth.uid()
     AND app.current_user_is_super_admin() THEN
    SELECT COALESCE(
      CASE
        WHEN u.raw_user_meta_data ? 'organization_id'
          AND (u.raw_user_meta_data->>'organization_id') ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (u.raw_user_meta_data->>'organization_id')::uuid
      END,
      CASE
        WHEN u.raw_user_meta_data ? 'organizationId'
          AND (u.raw_user_meta_data->>'organizationId') ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (u.raw_user_meta_data->>'organizationId')::uuid
      END,
      CASE
        WHEN p.preferences IS NOT NULL
          AND jsonb_typeof(p.preferences) = 'object'
          AND p.preferences ? 'organization_id'
          AND (p.preferences->>'organization_id') ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (p.preferences->>'organization_id')::uuid
      END,
      CASE
        WHEN p.preferences IS NOT NULL
          AND jsonb_typeof(p.preferences) = 'object'
          AND p.preferences ? 'organizationId'
          AND (p.preferences->>'organizationId') ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (p.preferences->>'organizationId')::uuid
      END
    )
    INTO resolved_org
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_user_id
    LIMIT 1;
  END IF;

  RETURN resolved_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) FROM public;
GRANT EXECUTE ON FUNCTION app.resolve_user_organization_id(uuid) TO service_role;

COMMIT;
