/*
  # Scope admin user listing by organization

  1. Changes
    - Recreate admin_users view with organization-aware filtering
    - Reintroduce get_admin_users(organization_id uuid) RPC enforcing org scoping
  2. Security
    - Restrict results to the caller's organization using metadata helper
    - Raise insufficient_privilege errors for unauthorized access attempts
*/

-- Drop the existing function before recreating dependencies
DROP FUNCTION IF EXISTS get_admin_users();

-- Recreate the admin_users view with security barrier and organization scoping
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
JOIN user_roles AS ur
  ON ur.user_id = u.id
JOIN roles AS r
  ON r.id = ur.role_id
WHERE r.name = 'admin'
  AND EXISTS (
    SELECT 1
    FROM user_roles AS ur2
    JOIN roles AS r2
      ON r2.id = ur2.role_id
    WHERE ur2.user_id = auth.uid()
      AND r2.name = 'admin'
  )
  AND get_organization_id_from_metadata(u.raw_user_meta_data) IS NOT NULL
  AND get_organization_id_from_metadata(u.raw_user_meta_data) = (
    SELECT get_organization_id_from_metadata(caller.raw_user_meta_data)
    FROM auth.users AS caller
    WHERE caller.id = auth.uid()
  );

-- Recreate the RPC with explicit organization scoping enforcement
CREATE OR REPLACE FUNCTION get_admin_users(organization_id uuid)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid;
  caller_org_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization ID is required';
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users AS u
  WHERE u.id = current_user_id;

  IF caller_org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller is not associated with an organization';
  END IF;

  IF caller_org_id <> organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles AS ur
    JOIN roles AS r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;

  RETURN QUERY
  SELECT au.*
  FROM admin_users AS au
  WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = organization_id;
END;
$$;

-- Ensure authenticated users (with appropriate RLS) can access the secured view and RPC
GRANT SELECT ON admin_users TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_users(uuid) TO authenticated;
