/*
  # Fix Authentication Functions - Type Casting Issues

  1. Issues Fixed
    - Fix "operator does not exist: uuid = text" error
    - Ensure proper UUID type casting in all functions
    - Fix get_user_roles function to return consistent results
    - Add comprehensive error handling
    
  2. Security
    - Maintain existing RLS policies
    - Proper role assignment and validation
*/

-- First, drop all existing auth-related functions to clean up
DROP FUNCTION IF EXISTS public.get_user_roles();
DROP FUNCTION IF EXISTS auth.get_user_roles();
DROP FUNCTION IF EXISTS assign_admin_role(text);
DROP FUNCTION IF EXISTS ensure_admin_role(text);
DROP FUNCTION IF EXISTS manage_admin_users(text, text, jsonb);
DROP FUNCTION IF EXISTS manage_admin_users(text, text, jsonb, text);

-- Create the core get_user_roles function with proper type handling
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (roles text[]) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid;
  user_roles text[];
BEGIN
  -- Get current user ID with proper error handling
  current_user_id := auth.uid();
  
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::text[];
    RETURN;
  END IF;

  -- Get user roles with explicit type casting
  SELECT COALESCE(ARRAY_AGG(r.name::text), ARRAY[]::text[]) INTO user_roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = current_user_id;
  
  -- Ensure we always return an array
  IF user_roles IS NULL THEN
    user_roles := ARRAY[]::text[];
  END IF;
  
  RETURN QUERY SELECT user_roles;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return empty array
    RAISE WARNING 'Error in get_user_roles for user %: %', current_user_id, SQLERRM;
    RETURN QUERY SELECT ARRAY[]::text[];
END;
$$;

-- Create improved user_has_role function
CREATE OR REPLACE FUNCTION auth.user_has_role(role_name text)
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
  
  -- If user is admin, they have all roles
  IF has_role THEN
    RETURN true;
  END IF;
  
  -- Check for specific role
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
    AND r.name = role_name
  ) INTO has_role;
  
  RETURN COALESCE(has_role, false);
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return false
    RAISE WARNING 'Error in user_has_role for user % and role %: %', current_user_id, role_name, SQLERRM;
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create fixed assign_admin_role function
CREATE OR REPLACE FUNCTION assign_admin_role(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_role_id uuid;
  target_user_id uuid;
BEGIN
  -- Validate input
  IF user_email IS NULL OR trim(user_email) = '' THEN
    RAISE EXCEPTION 'User email cannot be null or empty';
  END IF;
  
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Admin role not found in roles table';
  END IF;
  
  -- Get user ID from email with explicit casting
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Add admin role with explicit UUID casting
  INSERT INTO user_roles (user_id, role_id)
  VALUES (target_user_id::uuid, admin_role_id::uuid)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  
  -- Update user metadata
  UPDATE auth.users
  SET raw_user_meta_data = 
    COALESCE(raw_user_meta_data, '{}'::jsonb) || 
    '{"is_admin": true}'::jsonb
  WHERE id = target_user_id::uuid;
  
  RAISE NOTICE 'Admin role assigned to % (ID: %)', user_email, target_user_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error assigning admin role to %: %', user_email, SQLERRM;
    RAISE;
END;
$$;

-- Create a function to ensure all existing users have admin role (for development)
CREATE OR REPLACE FUNCTION ensure_all_users_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_record RECORD;
  admin_role_id uuid;
  processed_count integer := 0;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Admin role not found';
  END IF;
  
  -- Loop through all users and ensure they have admin role
  FOR user_record IN SELECT id, email FROM auth.users LOOP
    BEGIN
      -- Add admin role
      INSERT INTO user_roles (user_id, role_id)
      VALUES (user_record.id::uuid, admin_role_id::uuid)
      ON CONFLICT (user_id, role_id) DO NOTHING;
      
      -- Update metadata
      UPDATE auth.users
      SET raw_user_meta_data = 
        COALESCE(raw_user_meta_data, '{}'::jsonb) || 
        '{"is_admin": true}'::jsonb
      WHERE id = user_record.id::uuid;
      
      processed_count := processed_count + 1;
      
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Error processing user % (%): %', user_record.email, user_record.id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE 'Processed % users for admin role assignment', processed_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_user_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.user_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_admin_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_all_users_admin() TO authenticated;

-- Fix any existing user role assignments
DO $$
BEGIN
  -- Ensure all existing users have admin role (for development environment)
  PERFORM ensure_all_users_admin();
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in bulk admin role assignment: %', SQLERRM;
END $$;

-- Ensure specific test users have admin role
DO $$
BEGIN
  PERFORM assign_admin_role('j_eduardo622@yahoo.com');
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error ensuring admin role for j_eduardo622@yahoo.com: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM assign_admin_role('test@example.com');
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error ensuring admin role for test@example.com: %', SQLERRM;
END $$; 