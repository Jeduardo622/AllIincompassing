-- Create the get_user_roles function
CREATE OR REPLACE FUNCTION get_user_roles()
RETURNS TABLE (
  user_id uuid,
  roles text[]
) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    auth.uid() as user_id,
    ARRAY_AGG(r.name) as roles
  FROM
    user_roles ur
    JOIN roles r ON ur.role_id = r.id
  WHERE
    ur.user_id = auth.uid()
  GROUP BY
    auth.uid();
END;
$$
LANGUAGE plpgsql;

-- Create the assign_admin_role function
CREATE OR REPLACE FUNCTION assign_admin_role(user_email text)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  -- Get the user ID from the email
  SELECT id INTO v_user_id FROM auth.users WHERE email = user_email;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Get the admin role ID
  SELECT id INTO v_role_id FROM roles WHERE name = 'admin';
  
  IF v_role_id IS NULL THEN
    -- Create the admin role if it doesn't exist
    INSERT INTO roles (name, description) VALUES ('admin', 'Administrator role') RETURNING id INTO v_role_id;
  END IF;
  
  -- Check if the user already has the admin role
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_user_id AND role_id = v_role_id) THEN
    -- Assign the admin role to the user
    INSERT INTO user_roles (user_id, role_id) VALUES (v_user_id, v_role_id);
  END IF;
END;
$$
LANGUAGE plpgsql;

-- Create the manage_admin_users function
CREATE OR REPLACE FUNCTION manage_admin_users(
  operation text,
  target_user_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id uuid;
BEGIN
  -- Get the admin role ID
  SELECT id INTO v_role_id FROM roles WHERE name = 'admin';
  
  IF v_role_id IS NULL THEN
    -- Create the admin role if it doesn't exist
    INSERT INTO roles (name, description) VALUES ('admin', 'Administrator role') RETURNING id INTO v_role_id;
  END IF;
  
  IF operation = 'add' THEN
    -- Check if the user already has the admin role
    IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = target_user_id AND role_id = v_role_id) THEN
      -- Assign the admin role to the user
      INSERT INTO user_roles (user_id, role_id) VALUES (target_user_id, v_role_id);
    END IF;
  ELSIF operation = 'remove' THEN
    -- Remove the admin role from the user
    DELETE FROM user_roles WHERE user_id = target_user_id AND role_id = v_role_id;
  ELSE
    RAISE EXCEPTION 'Invalid operation: %. Must be "add" or "remove"', operation;
  END IF;
END;
$$
LANGUAGE plpgsql;

-- Ensure the roles table exists
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Ensure the user_roles table exists
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role_id)
);

-- Create admin role if it doesn't exist
INSERT INTO roles (name, description)
VALUES ('admin', 'Administrator role')
ON CONFLICT (name) DO NOTHING;

-- Create therapist role if it doesn't exist
INSERT INTO roles (name, description)
VALUES ('therapist', 'Therapist role')
ON CONFLICT (name) DO NOTHING;