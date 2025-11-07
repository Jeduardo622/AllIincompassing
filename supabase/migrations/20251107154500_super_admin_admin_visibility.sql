-- Allow super admins to enumerate admin users across organizations while keeping
-- administrators scoped to their own organization context.
DROP FUNCTION IF EXISTS get_admin_users(uuid);
DROP VIEW IF EXISTS admin_users;

CREATE OR REPLACE VIEW admin_users
WITH (security_barrier = true) AS
SELECT
  u.id AS id,
  ur.id AS user_role_id,
  u.id AS user_id,
  u.email,
  u.raw_user_meta_data,
  u.created_at
FROM auth.users AS u
JOIN user_roles AS ur ON ur.user_id = u.id
JOIN roles AS r ON r.id = ur.role_id
WHERE r.name = 'admin'
  AND (
    EXISTS (
      SELECT 1
      FROM user_roles AS caller_roles
      JOIN roles AS caller_role_def ON caller_role_def.id = caller_roles.role_id
      WHERE caller_roles.user_id = auth.uid()
        AND caller_role_def.name = 'super_admin'
    )
    OR (
      EXISTS (
        SELECT 1
        FROM user_roles AS caller_roles
        JOIN roles AS caller_role_def ON caller_role_def.id = caller_roles.role_id
        WHERE caller_roles.user_id = auth.uid()
          AND caller_role_def.name = 'admin'
      )
      AND get_organization_id_from_metadata(u.raw_user_meta_data) IS NOT NULL
      AND get_organization_id_from_metadata(u.raw_user_meta_data) = (
        SELECT get_organization_id_from_metadata(caller.raw_user_meta_data)
        FROM auth.users AS caller
        WHERE caller.id = auth.uid()
      )
    )
  );

CREATE OR REPLACE FUNCTION get_admin_users(organization_id uuid DEFAULT NULL)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  caller_org_id uuid;
  caller_is_super_admin boolean;
  caller_is_admin boolean;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM user_roles AS ur
    JOIN roles AS r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'super_admin'
  ) INTO caller_is_super_admin;

  SELECT EXISTS (
    SELECT 1
    FROM user_roles AS ur
    JOIN roles AS r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) INTO caller_is_admin;

  IF NOT caller_is_super_admin AND NOT caller_is_admin THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators or super admins can view admin users';
  END IF;

  IF caller_is_admin THEN
    SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
    INTO caller_org_id
    FROM auth.users AS u
    WHERE u.id = current_user_id;

    IF caller_org_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller is not associated with an organization';
    END IF;

    IF organization_id IS NULL THEN
      organization_id := caller_org_id;
    ELSIF organization_id <> caller_org_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
    END IF;

    RETURN QUERY
    SELECT au.*
    FROM admin_users AS au
    WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = caller_org_id;

    RETURN;
  END IF;

  -- Super admins can view all admin users, optionally filtered by organization.
  IF organization_id IS NOT NULL THEN
    RETURN QUERY
    SELECT au.*
    FROM admin_users AS au
    WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = organization_id;
  ELSE
    RETURN QUERY
    SELECT au.*
    FROM admin_users AS au;
  END IF;

  RETURN;
END;
$$;

GRANT SELECT ON admin_users TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_users(uuid) TO authenticated;
