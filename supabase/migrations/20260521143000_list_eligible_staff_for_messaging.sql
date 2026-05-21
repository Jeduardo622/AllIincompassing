-- @migration-intent: Org-scoped staff recipient listing for staff messaging compose without widening profiles SELECT RLS.
-- @migration-dependencies: 20260310190000_auth_access_hardening.sql, 20260313120000_onboarding_authz_and_prefill_retention_hardening.sql
-- @migration-rollback: DROP FUNCTION IF EXISTS public.list_eligible_staff_for_messaging(uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.list_eligible_staff_for_messaging(
  p_organization_id uuid
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, app
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_org uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization context required';
  END IF;

  v_actor_org := app.resolve_user_organization_id(v_actor);
  IF v_actor_org IS NULL OR v_actor_org <> p_organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;

  IF NOT app.user_has_role_for_org(v_actor, p_organization_id, ARRAY['therapist', 'admin', 'super_admin']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Insufficient role to list messaging recipients';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    p.id AS user_id,
    COALESCE(NULLIF(BTRIM(p.full_name), ''), NULLIF(BTRIM(p.email), ''), 'Staff member') AS full_name,
    COALESCE(p.email, '') AS email,
    CASE
      WHEN r.name IN ('admin', 'org_admin') THEN 'admin'
      WHEN r.name IN ('super_admin', 'org_super_admin') THEN 'super_admin'
      WHEN r.name IN ('therapist', 'org_member') THEN 'therapist'
      ELSE r.name
    END AS role
  FROM public.profiles p
  INNER JOIN public.user_roles ur ON ur.user_id = p.id
  INNER JOIN public.roles r ON r.id = ur.role_id
  WHERE p.organization_id = p_organization_id
    AND COALESCE(p.is_active, true) = true
    AND p.id <> v_actor
    AND COALESCE(ur.is_active, true) = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
    AND r.name IN (
      'therapist',
      'admin',
      'super_admin',
      'org_member',
      'org_admin',
      'org_super_admin'
    )
  ORDER BY full_name, email, user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_eligible_staff_for_messaging(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_eligible_staff_for_messaging(uuid) TO authenticated, service_role;

COMMIT;
