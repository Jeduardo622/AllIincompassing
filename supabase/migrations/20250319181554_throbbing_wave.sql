/*
  # Fix Admin View and Function Dependencies

  1. Changes
    - Drop function first since it depends on the view
    - Drop and recreate view
    - Recreate function with proper dependencies
    
  2. Security
    - Maintain existing RLS policies
    - Ensure proper admin checks
*/

-- Drop function first since it depends on the view
DROP FUNCTION IF EXISTS get_admin_users();
DROP FUNCTION IF EXISTS get_admin_users(uuid);

-- Now we can safely drop and recreate the view
DROP VIEW IF EXISTS admin_users;

-- Create improved admin_users view
CREATE VIEW admin_users AS
SELECT 
  ur.id as user_role_id,
  u.id as user_id,
  u.email,
  u.raw_user_meta_data,
  u.created_at
FROM auth.users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON ur.role_id = r.id
WHERE r.name = 'admin'
  AND EXISTS (
    SELECT 1 
    FROM user_roles ur2
    JOIN roles r2 ON ur2.role_id = r2.id
    WHERE ur2.user_id = auth.uid()
    AND r2.name = 'admin'
  );

-- Create get_admin_users function
CREATE OR REPLACE FUNCTION get_admin_users()
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if current user is admin
  IF NOT EXISTS (
    SELECT 1 
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only administrators can view admin users';
  END IF;

  RETURN QUERY SELECT * FROM admin_users;
END;
$$;

-- Grant necessary permissions
GRANT SELECT ON admin_users TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_users() TO authenticated;