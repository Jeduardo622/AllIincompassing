-- @migration-intent: Break the BCBA/super-admin precedence tie so global super_admin consistently outranks BCBA in profile sync and employee listings.
-- @migration-dependencies: 20260706023600_bcba_exact_capability_matrix.sql,20260702222500_restrict_employee_users_paged_execute_grants.sql
-- @migration-rollback: Re-apply 20260701150000_employee_role_capability_matrix.sql and 20260702120000_super_admin_employee_role_listing.sql if BCBA must regain parity with super_admin.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_user_role_from_junction(p_user_id uuid)
RETURNS public.role_type
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT r.name INTO user_role
  FROM public.user_roles ur
  JOIN public.roles r ON ur.role_id = r.id
  WHERE ur.user_id = p_user_id
    AND COALESCE(ur.is_active, true) = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
  ORDER BY
    CASE r.name
      WHEN 'super_admin' THEN 8
      WHEN 'bcba' THEN 7
      WHEN 'admin' THEN 6
      WHEN 'admin_schedule' THEN 5
      WHEN 'midtier' THEN 4
      WHEN 'therapist' THEN 3
      WHEN 'bt' THEN 2
      WHEN 'client' THEN 1
      ELSE 0
    END DESC
  LIMIT 1;

  RETURN COALESCE(user_role::public.role_type, 'client'::public.role_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_users_paged(
  p_organization_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  full_name text,
  title text,
  role public.role_type,
  is_active boolean,
  organization_id uuid,
  created_at timestamptz,
  last_login_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, app, pg_temp
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_super_admin boolean := public.current_user_is_super_admin();
  limit_value integer := GREATEST(p_limit, 1);
  offset_value integer := GREATEST(p_offset, 0);
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF NOT is_super_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only super administrators can view employee users';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.first_name,
    p.last_name,
    p.full_name,
    p.title,
    effective_role.role,
    p.is_active,
    p.organization_id,
    p.created_at,
    p.last_login_at
  FROM public.profiles p
  JOIN LATERAL (
    SELECT r.name::public.role_type AS role
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p.id
      AND COALESCE(ur.is_active, true) = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.name IN ('bt', 'therapist', 'midtier', 'admin_schedule', 'admin', 'bcba', 'super_admin')
    ORDER BY
      CASE r.name
        WHEN 'super_admin' THEN 8
        WHEN 'bcba' THEN 7
        WHEN 'admin' THEN 6
        WHEN 'admin_schedule' THEN 5
        WHEN 'midtier' THEN 4
        WHEN 'therapist' THEN 3
        WHEN 'bt' THEN 2
        ELSE 0
      END DESC
    LIMIT 1
  ) effective_role ON true
  WHERE effective_role.role <> 'client'::public.role_type
    AND (p_organization_id IS NULL OR p.organization_id = p_organization_id)
  ORDER BY
    p.last_name ASC NULLS LAST,
    p.first_name ASC NULLS LAST,
    p.email ASC
  LIMIT limit_value
  OFFSET offset_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role_from_junction(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
