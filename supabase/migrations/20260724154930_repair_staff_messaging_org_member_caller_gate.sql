-- @migration-intent: Restore exact org_member therapist parity for staff messaging without widening the recipient-list caller gate to client identities.
-- @migration-dependencies: 20260724100000_align_staff_messaging_direct_member_roles.sql
-- @migration-rollback: Forward recovery only. Apply a later migration that reinstates the prior caller-gate semantics if direct staff recipient eligibility needs to change again.

BEGIN;

CREATE OR REPLACE FUNCTION app.is_active_staff_messaging_member(
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE p.id = p_user_id
      AND app.resolve_user_organization_id(p_user_id) = p_organization_id
      AND COALESCE(p.is_active, true) = true
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > timezone('utc', now()))
      AND r.name IN (
        'bt',
        'therapist',
        'midtier',
        'admin_schedule',
        'admin',
        'bcba',
        'super_admin',
        'org_member',
        'org_admin',
        'org_super_admin'
      )
  );
$$;

REVOKE ALL ON FUNCTION app.is_active_staff_messaging_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_active_staff_messaging_member(uuid, uuid) TO authenticated, service_role;

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

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles actor_profile
    JOIN public.user_roles actor_role_link ON actor_role_link.user_id = actor_profile.id
    JOIN public.roles actor_role ON actor_role.id = actor_role_link.role_id
    WHERE actor_profile.id = v_actor
      AND actor_profile.organization_id = p_organization_id
      AND COALESCE(actor_profile.is_active, true) = true
      AND COALESCE(actor_role_link.is_active, true) = true
      AND (actor_role_link.expires_at IS NULL OR actor_role_link.expires_at > timezone('utc', now()))
      AND actor_role.name IN (
        'bt',
        'therapist',
        'midtier',
        'admin_schedule',
        'admin',
        'bcba',
        'super_admin',
        'org_member',
        'org_admin',
        'org_super_admin'
      )
  ) THEN
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
      'bt',
      'therapist',
      'midtier',
      'admin_schedule',
      'admin',
      'bcba',
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
