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

-- Drop existing view if it exists
DROP FUNCTION IF EXISTS get_admin_users();
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

-- Create function to get admin users
CREATE OR REPLACE FUNCTION get_admin_users()
RETURNS SETOF admin_users
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM admin_users;
$$;

-- Update manage_admin_users function with better error handling
CREATE OR REPLACE FUNCTION manage_admin_users(operation text, target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_role_id uuid;
  current_user_id uuid;
  admin_count integer;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
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

  -- Get total number of admins
  SELECT COUNT(*) INTO admin_count
  FROM user_roles
  WHERE role_id = admin_role_id;

  -- Prevent removing the last admin
  IF operation = 'remove' AND target_user_id = current_user_id AND admin_count <= 1 THEN
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

-- Grant necessary permissions
GRANT SELECT ON admin_users TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION manage_admin_users(text, uuid) TO authenticated;