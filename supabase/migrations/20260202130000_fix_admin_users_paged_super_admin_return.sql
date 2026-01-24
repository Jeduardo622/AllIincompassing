BEGIN;

-- Ensure super_admin requests return before admin-only checks.

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
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  resolved_org uuid := organization_id;
  is_super_admin boolean := public.current_user_is_super_admin() OR app.user_has_role('super_admin');
  limit_value integer := GREATEST(p_limit, 1);
  offset_value integer := GREATEST(p_offset, 0);
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF is_super_admin THEN
    IF resolved_org IS NULL THEN
      RETURN QUERY
      SELECT *
      FROM admin_users
      ORDER BY created_at DESC
      LIMIT limit_value
      OFFSET offset_value;
    ELSE
      RETURN QUERY
      SELECT *
      FROM admin_users
      WHERE get_organization_id_from_metadata(raw_user_meta_data) = resolved_org
      ORDER BY created_at DESC
      LIMIT limit_value
      OFFSET offset_value;
    END IF;

    RETURN;
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users u
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

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;

  RETURN QUERY
  SELECT *
  FROM admin_users
  WHERE get_organization_id_from_metadata(raw_user_meta_data) = resolved_org
  ORDER BY created_at DESC
  LIMIT limit_value
  OFFSET offset_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_users_paged(uuid, integer, integer) TO authenticated;

COMMIT;
