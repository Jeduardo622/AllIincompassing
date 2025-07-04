/*
  # Create Authentication Helper Functions

  1. Functions
    - `get_user_roles` - Gets roles for the current user
    - `user_has_role` - Checks if the current user has a specific role
    - `assign_admin_role` - Assigns the admin role to a user
    - `manage_admin_users` - Manages admin users
*/

-- Function to get user roles
DROP FUNCTION IF EXISTS get_user_roles();

CREATE OR REPLACE FUNCTION get_user_roles()
RETURNS TABLE (
  user_id UUID,
  roles TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    auth.uid() as user_id,
    array_agg(r.name) as roles
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = auth.uid()
  GROUP BY 1;
END;
$$;

-- Function to check if user has a role
CREATE OR REPLACE FUNCTION user_has_role(role_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_role BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name = role_name
  ) INTO v_has_role;
  
  RETURN v_has_role;
END;
$$;

-- Function to assign admin role to a user
CREATE OR REPLACE FUNCTION assign_admin_role(user_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_admin_role_id UUID;
BEGIN
  -- Get user ID from email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Get admin role ID
  SELECT id INTO v_admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  IF v_admin_role_id IS NULL THEN
    -- Create admin role if it doesn't exist
    INSERT INTO roles (name, description)
    VALUES ('admin', 'Administrator role with full access')
    RETURNING id INTO v_admin_role_id;
  END IF;
  
  -- Assign admin role to user
  INSERT INTO user_roles (user_id, role_id)
  VALUES (v_user_id, v_admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;

-- Function to manage admin users
CREATE OR REPLACE FUNCTION manage_admin_users(
  operation TEXT,
  target_user_id UUID,
  metadata JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_role_id UUID;
BEGIN
  -- Get admin role ID
  SELECT id INTO v_admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  IF v_admin_role_id IS NULL THEN
    -- Create admin role if it doesn't exist
    INSERT INTO roles (name, description)
    VALUES ('admin', 'Administrator role with full access')
    RETURNING id INTO v_admin_role_id;
  END IF;
  
  -- Perform the requested operation
  CASE operation
    WHEN 'add' THEN
      -- Add admin role to user
      INSERT INTO user_roles (user_id, role_id)
      VALUES (target_user_id, v_admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
      
    WHEN 'remove' THEN
      -- Remove admin role from user
      DELETE FROM user_roles
      WHERE user_id = target_user_id
        AND role_id = v_admin_role_id;
      
    ELSE
      RAISE EXCEPTION 'Invalid operation: %', operation;
  END CASE;
END;
$$;