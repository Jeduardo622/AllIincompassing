/*
  @migration-intent: Add a super-admin-only employee user listing RPC for controlled role management UI.
  @migration-dependencies: 20260202124000_forward_fix_admin_users_paged_super_admin_return.sql
  @migration-rollback: DROP FUNCTION IF EXISTS public.get_employee_users_paged(uuid, integer, integer);
*/

BEGIN;

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
        WHEN 'bcba' THEN 8
        WHEN 'admin' THEN 7
        WHEN 'admin_schedule' THEN 6
        WHEN 'midtier' THEN 5
        WHEN 'therapist' THEN 4
        WHEN 'bt' THEN 3
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

GRANT EXECUTE ON FUNCTION public.get_employee_users_paged(uuid, integer, integer) TO authenticated;

COMMIT;
