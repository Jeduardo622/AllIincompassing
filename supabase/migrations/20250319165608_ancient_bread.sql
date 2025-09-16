/*
  # Fix Admin Users View and Management Functions

  1. Changes
    - Create secure view for admin users
    - Add function to manage admin users
    - Handle proper security through function permissions

  2. Security
    - Use security barrier view
    - Implement security definer functions
    - Proper permission checks
*/

-- Drop existing objects if they exist before recreating them safely
DROP FUNCTION IF EXISTS get_organization_id_from_metadata(jsonb);
DROP FUNCTION IF EXISTS get_admin_users();
DROP FUNCTION IF EXISTS get_admin_users(uuid);
DROP FUNCTION IF EXISTS manage_admin_users(text, uuid);
DROP FUNCTION IF EXISTS manage_admin_users(text, uuid, uuid);
DROP VIEW IF EXISTS admin_users;

-- Create secure view for admin users
CREATE VIEW admin_users
WITH (security_barrier = true)
AS
SELECT
  ur.id as user_role_id,
  ur.user_id,
  au.email,
  au.raw_user_meta_data,
  au.created_at
FROM user_roles ur
JOIN auth.users au ON ur.user_id = au.id
JOIN roles r ON ur.role_id = r.id
WHERE r.name = 'admin'
  AND (
    -- Only show results if current user is an admin
    EXISTS (
      SELECT 1
      FROM user_roles ur2
      JOIN roles r2 ON ur2.role_id = r2.id
      WHERE ur2.user_id = auth.uid()
      AND r2.name = 'admin'
    )
  );

-- Helper to safely extract an organization ID from user metadata
CREATE OR REPLACE FUNCTION get_organization_id_from_metadata(p_metadata jsonb)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_metadata ? 'organization_id'
         AND (p_metadata->>'organization_id') ~* '^[0-9a-fA-F-]{36}$'
      THEN (p_metadata->>'organization_id')::uuid
    WHEN p_metadata ? 'organizationId'
         AND (p_metadata->>'organizationId') ~* '^[0-9a-fA-F-]{36}$'
      THEN (p_metadata->>'organizationId')::uuid
    ELSE NULL
  END;
$$;

-- Create function to get admin users
CREATE OR REPLACE FUNCTION get_admin_users(p_organization_id uuid)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid;
  current_user_org_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  -- Resolve the caller''s organization from their metadata
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO current_user_org_id
  FROM auth.users u
  WHERE u.id = current_user_id;

  IF current_user_org_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not associated with an organization';
  END IF;

  IF current_user_org_id <> p_organization_id THEN
    RAISE EXCEPTION 'Caller organization mismatch';
  END IF;

  -- Ensure the caller is an administrator
  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only administrators can list admin users';
  END IF;

  RETURN QUERY
  SELECT au.*
  FROM admin_users au
  WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = p_organization_id;
END;
$$;

-- Update manage_admin_users function with better error handling
CREATE OR REPLACE FUNCTION manage_admin_users(
  operation text,
  target_user_id uuid,
  caller_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  admin_role_id uuid;
  current_user_id uuid;
  admin_count integer;
  current_user_org_id uuid;
  target_user_org_id uuid;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF caller_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';

  -- Check if current user is admin
  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = current_user_id
    AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only administrators can manage admin users';
  END IF;

  -- Resolve organizations for caller and target users
  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO current_user_org_id
  FROM auth.users u
  WHERE u.id = current_user_id;

  IF current_user_org_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not associated with an organization';
  END IF;

  IF current_user_org_id <> caller_organization_id THEN
    RAISE EXCEPTION 'Caller organization mismatch';
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO target_user_org_id
  FROM auth.users u
  WHERE u.id = target_user_id;

  IF target_user_org_id IS NULL THEN
    RAISE EXCEPTION 'Target user is not associated with an organization';
  END IF;

  IF target_user_org_id <> caller_organization_id THEN
    RAISE EXCEPTION 'Target user does not belong to the caller organization';
  END IF;

  -- Get total number of admins
  SELECT COUNT(*) INTO admin_count
  FROM user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.role_id = admin_role_id
    AND get_organization_id_from_metadata(au.raw_user_meta_data) = caller_organization_id;

  -- Prevent removing the last admin
  IF operation = 'remove'
     AND target_user_id = current_user_id
     AND admin_count <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last administrator';
  END IF;

  CASE operation
    WHEN 'add' THEN
      -- Add admin role
      INSERT INTO user_roles (user_id, role_id)
      VALUES (target_user_id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;

    WHEN 'remove' THEN
      -- Remove admin role
      DELETE FROM user_roles
      WHERE user_id = target_user_id
      AND role_id = admin_role_id;

    ELSE
      RAISE EXCEPTION 'Invalid operation: %', operation;
  END CASE;
END;
$$;

-- Create a dedicated role for privileged access if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin_executor') THEN
    CREATE ROLE app_admin_executor NOLOGIN;
  END IF;
END $$;

-- Ensure the Supabase service role can inherit the privileges when present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT app_admin_executor TO service_role;
  END IF;
END $$;

-- Adjust permissions to limit execution to the dedicated role
REVOKE SELECT ON admin_users FROM authenticated;
REVOKE EXECUTE ON FUNCTION get_admin_users() FROM authenticated;
REVOKE EXECUTE ON FUNCTION get_admin_users(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION manage_admin_users(text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION manage_admin_users(text, uuid, uuid) FROM authenticated;

GRANT SELECT ON admin_users TO app_admin_executor;
GRANT EXECUTE ON FUNCTION get_admin_users(uuid) TO app_admin_executor;
GRANT EXECUTE ON FUNCTION manage_admin_users(text, uuid, uuid) TO app_admin_executor;
