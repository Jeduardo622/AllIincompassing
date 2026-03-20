/*
  # Fix User Role Persistence and Authentication

  1. Changes
    - Improve user_has_role function to properly handle admin role
    - Fix get_user_roles function to handle null results
    - Add better error handling and logging
    - Ensure admin role is properly assigned
    
  2. Security
    - Maintain existing RLS policies
    - Ensure proper role assignment
*/

-- Improve user_has_role function with better error handling
CREATE OR REPLACE FUNCTION public.user_has_role(role_name text)
RETURNS boolean AS $$
DECLARE
  has_role boolean;
  current_user_id uuid;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check for admin role first (admins have all roles)
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
    AND r.name = 'admin'
  ) INTO has_role;
  
  IF has_role THEN
    RETURN true;
  END IF;
  
  -- If checking for admin role specifically, we already know the answer
  IF role_name = 'admin' THEN
    RETURN false;
  END IF;
  
  -- Check for specific role
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
    AND r.name = role_name
  ) INTO has_role;
  
  RETURN has_role;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return false
    RAISE WARNING 'Error in user_has_role: %', SQLERRM;
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix get_user_roles function to handle null results and add error logging
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (roles text[]) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid;
  user_roles text[];
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::text[];
    RETURN;
  END IF;

  -- Get user roles
  SELECT ARRAY_AGG(r.name) INTO user_roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = current_user_id;
  
  -- If no roles found, return empty array
  IF user_roles IS NULL THEN
    user_roles := ARRAY[]::text[];
  END IF;
  
  RETURN QUERY SELECT user_roles;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return empty array
    RAISE WARNING 'Error in get_user_roles: %', SQLERRM;
    RETURN QUERY SELECT ARRAY[]::text[];
END;
$$;

-- Create function to ensure user has admin role
CREATE OR REPLACE FUNCTION ensure_admin_role(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_role_id uuid;
  target_user_id uuid;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  -- Get user ID from email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Add admin role
  INSERT INTO user_roles (user_id, role_id)
  VALUES (target_user_id, admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  
  -- Update user metadata
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    '{"is_admin": true}'::jsonb
  WHERE id = target_user_id;
  
  RAISE NOTICE 'Admin role ensured for %', user_email;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error ensuring admin role: %', SQLERRM;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.user_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_admin_role(text) TO authenticated;

-- Ensure test user has admin role
DO $$
BEGIN
  PERFORM ensure_admin_role('test@example.com');
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error ensuring admin role for test@example.com: %', SQLERRM;
END $$;

-- Ensure j_eduardo622@yahoo.com has admin role
DO $$
BEGIN
  PERFORM ensure_admin_role('j_eduardo622@yahoo.com');
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error ensuring admin role for j_eduardo622@yahoo.com: %', SQLERRM;
END $$;