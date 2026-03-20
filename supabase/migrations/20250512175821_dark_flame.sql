-- Improve user_has_role function
CREATE OR REPLACE FUNCTION public.user_has_role(role_name text)
RETURNS boolean AS $$
DECLARE
  has_role boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
    AND r.name = role_name
  ) INTO has_role;
  
  RETURN has_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to ensure user has admin role
CREATE OR REPLACE FUNCTION ensure_user_has_admin_role(p_user_id uuid)
RETURNS void AS $$
DECLARE
  admin_role_id uuid;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  -- Add admin role if not exists
  INSERT INTO user_roles (user_id, role_id)
  VALUES (p_user_id, admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  
  -- Update user metadata
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    '{"is_admin": true}'::jsonb
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix get_user_roles function to handle null results
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (roles text[]) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT COALESCE(ARRAY_AGG(r.name), ARRAY[]::text[]) as roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
  GROUP BY ur.user_id;
  
  -- If no rows returned, return empty array
  IF NOT FOUND THEN
    RETURN QUERY SELECT ARRAY[]::text[];
  END IF;
END;
$$;

-- Ensure current user has admin role
DO $$
DECLARE
  current_user_id uuid;
  current_user_email text;
  admin_role_id uuid;
BEGIN
  -- Get current user info from session
  SELECT auth.uid() INTO current_user_id;
  
  IF current_user_id IS NOT NULL THEN
    -- Get user email
    SELECT email INTO current_user_email
    FROM auth.users
    WHERE id = current_user_id;
    
    -- Get admin role ID
    SELECT id INTO admin_role_id
    FROM roles
    WHERE name = 'admin';
    
    -- Add admin role to current user
    INSERT INTO user_roles (user_id, role_id)
    VALUES (current_user_id, admin_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
    
    -- Update user metadata
    UPDATE auth.users
    SET raw_user_meta_data = 
      COALESCE(raw_user_meta_data, '{}'::jsonb) || 
      '{"is_admin": true}'::jsonb
    WHERE id = current_user_id;
    
    RAISE NOTICE 'Added admin role to user: % (%)', current_user_email, current_user_id;
  END IF;
END $$;

-- Add admin role to specific users
DO $$
DECLARE
  admin_role_id uuid;
  target_user_id uuid;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  -- Add admin role to j_eduardo622@yahoo.com
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = 'j_eduardo622@yahoo.com';
  
  IF target_user_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id)
    VALUES (target_user_id, admin_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
    
    -- Update user metadata
    UPDATE auth.users
    SET raw_user_meta_data = 
      COALESCE(raw_user_meta_data, '{}'::jsonb) || 
      '{"is_admin": true}'::jsonb
    WHERE id = target_user_id;
    
    RAISE NOTICE 'Added admin role to j_eduardo622@yahoo.com';
  END IF;
END $$;