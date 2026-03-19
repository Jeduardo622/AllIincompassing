/*
  # Fix Admin Permissions and RLS Policies

  1. Changes
    - Add admin access to user management
    - Fix RLS policies for user_roles table
    - Add function to manage admin users
    - Add policy for admin user management
    
  2. Security
    - Maintain secure role-based access
    - Add proper admin checks
*/

-- Drop existing policies
DROP POLICY IF EXISTS "User roles are viewable by authenticated users" ON user_roles;

-- Create new policies for user_roles
CREATE POLICY "User roles access control"
ON user_roles
FOR ALL
TO authenticated
USING (
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM user_roles current_user_roles
      JOIN roles current_roles ON current_roles.id = current_user_roles.role_id
      WHERE current_user_roles.user_id = auth.uid()
        AND current_roles.name = 'admin'
    ) THEN true
    ELSE user_id = auth.uid()
  END
);

-- Create function to manage admin users
CREATE OR REPLACE FUNCTION manage_admin_users(operation text, target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_role_id uuid;
BEGIN
  -- Check if current user is admin
  IF NOT EXISTS (
    SELECT 1
    FROM user_roles current_user_roles
    JOIN roles current_roles ON current_roles.id = current_user_roles.role_id
    WHERE current_user_roles.user_id = auth.uid()
      AND current_roles.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only administrators can manage admin users';
  END IF;

  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';

  CASE operation
    WHEN 'add' THEN
      INSERT INTO user_roles (user_id, role_id)
      VALUES (target_user_id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    WHEN 'remove' THEN
      DELETE FROM user_roles
      WHERE user_id = target_user_id
      AND role_id = admin_role_id;
    ELSE
      RAISE EXCEPTION 'Invalid operation';
  END CASE;
END;
$$;