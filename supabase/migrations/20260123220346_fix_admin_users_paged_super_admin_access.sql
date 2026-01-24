-- Fix get_admin_users_paged to restore super_admin access
-- Migration 20251224120000 removed super_admin support, causing 403 errors
-- This restores the ability for super_admin to view admin users across organizations

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_users_paged(
  organization_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid;
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  is_super_admin boolean;
  limit_value integer := GREATEST(p_limit, 1);
  offset_value integer := GREATEST(p_offset, 0);
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  -- Check if caller is super_admin using the standard helper
  is_super_admin := app.current_user_is_super_admin();

  -- Super admin path: can view all admins or filter by organization
  IF is_super_admin THEN
    IF resolved_org IS NULL THEN
      -- Super admin viewing all admins across organizations
      RETURN QUERY
      SELECT au.*
      FROM admin_users au
      ORDER BY au.created_at DESC
      LIMIT limit_value
      OFFSET offset_value;
    ELSE
      -- Super admin viewing admins for a specific organization
      RETURN QUERY
      SELECT au.*
      FROM admin_users au
      WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = resolved_org
      ORDER BY au.created_at DESC
      LIMIT limit_value
      OFFSET offset_value;
    END IF;
    RETURN;
  END IF;

  -- Regular admin path: requires organization context and matching org
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users AS u
  WHERE u.id = current_user_id;

  IF caller_org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization context required';
  END IF;

  IF resolved_org IS NULL THEN
    resolved_org := caller_org_id;
  END IF;

  IF caller_org_id <> resolved_org THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;

  -- Verify caller has admin role
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;

  -- Return admins for the caller's organization
  RETURN QUERY
  SELECT au.*
  FROM admin_users au
  WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = resolved_org
  ORDER BY au.created_at DESC
  LIMIT limit_value
  OFFSET offset_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_users_paged(uuid, integer, integer) TO authenticated;

COMMIT;
