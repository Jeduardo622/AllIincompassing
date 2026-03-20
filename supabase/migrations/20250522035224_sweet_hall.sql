/*
  # Fix User Roles and Authentication Functions

  1. Changes
    - Improve user_has_role function to properly handle admin role
    - Fix get_user_roles function to handle null results
    - Add function to ensure user has admin role
    - Update manage_admin_users function for better error handling
    
  2. Security
    - Maintain existing RLS policies
    - Ensure proper role assignment
*/

-- Improve user_has_role function to properly handle admin role
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
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::text[];
    RETURN;
  END IF;

  -- Get user roles
  RETURN QUERY
  SELECT COALESCE(ARRAY_AGG(r.name), ARRAY[]::text[]) as roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = current_user_id
  GROUP BY ur.user_id;
  
  -- If no rows returned, return empty array
  IF NOT FOUND THEN
    RETURN QUERY SELECT ARRAY[]::text[];
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return empty array
    RAISE WARNING 'Error in get_user_roles: %', SQLERRM;
    RETURN QUERY SELECT ARRAY[]::text[];
END;
$$;

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

-- Update manage_admin_users function with better error handling
CREATE OR REPLACE FUNCTION manage_admin_users(
  operation text,
  target_user_id text,
  metadata jsonb DEFAULT NULL,
  password text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_role_id uuid;
  current_user_id uuid;
  target_id uuid;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  -- If target_user_id is a UUID, use it directly
  BEGIN
    target_id := target_user_id::uuid;
  EXCEPTION 
    WHEN OTHERS THEN
      -- If not a UUID, assume it's an email
      SELECT id INTO target_id
      FROM auth.users
      WHERE email = target_user_id;
      
      -- If still not found, create a new user
      IF target_id IS NULL AND target_user_id ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        -- Generate new UUID
        target_id := gen_random_uuid();
        
        -- Create new user with password if provided
        INSERT INTO auth.users (
          id,
          instance_id,
          email,
          encrypted_password,
          email_confirmed_at,
          role,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change_token_current,
          aud,
          is_super_admin,
          is_sso_user
        ) VALUES (
          target_id,
          gen_random_uuid(),
          target_user_id,
          CASE 
            WHEN password IS NOT NULL THEN crypt(password, gen_salt('bf'))
            ELSE crypt(gen_random_uuid()::text, gen_salt('bf'))
          END,
          now(),
          'authenticated',
          '{"provider":"email","providers":["email"]}'::jsonb,
          COALESCE(metadata, '{}'::jsonb),
          now(),
          now(),
          '',
          '',
          '',
          '',
          'authenticated',
          false,
          false
        );

        -- Create identity
        INSERT INTO auth.identities (
          id,
          user_id,
          identity_data,
          provider,
          provider_id,
          last_sign_in_at,
          created_at,
          updated_at
        ) VALUES (
          target_id,
          target_id,
          jsonb_build_object(
            'sub', target_id::text,
            'email', target_user_id
          ),
          'email',
          target_user_id,
          now(),
          now(),
          now()
        );
      END IF;
  END;

  -- Perform the requested operation
  CASE operation
    WHEN 'add' THEN
      -- Add admin role
      INSERT INTO user_roles (user_id, role_id)
      VALUES (target_id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;

      -- Update user metadata to mark as admin
      UPDATE auth.users
      SET raw_user_meta_data = 
        COALESCE(raw_user_meta_data, '{}'::jsonb) || 
        '{"is_admin": true}'::jsonb
      WHERE id = target_id;

      -- Log success
      RAISE NOTICE 'Admin role added to user %', target_id;

    WHEN 'remove' THEN
      -- Remove admin role
      DELETE FROM user_roles
      WHERE user_id = target_id
      AND role_id = admin_role_id;

      -- Update user metadata to remove admin flag
      UPDATE auth.users
      SET raw_user_meta_data = 
        raw_user_meta_data - 'is_admin'
      WHERE id = target_id;

      -- Log success
      RAISE NOTICE 'Admin role removed from user %', target_id;

    ELSE
      RAISE EXCEPTION 'Invalid operation: %', operation;
  END CASE;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error details
    RAISE WARNING 'Error in manage_admin_users: % (operation: %, target: %)', 
      SQLERRM, operation, target_user_id;
    -- Re-raise the exception
    RAISE;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION manage_admin_users(text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_user_has_admin_role(uuid) TO authenticated;

-- Add admin role to test user if it doesn't exist
DO $$
DECLARE
  admin_role_id uuid;
  test_user_id uuid;
BEGIN
  -- Get admin role ID
  SELECT id INTO admin_role_id
  FROM roles
  WHERE name = 'admin';
  
  -- Get test user ID
  SELECT id INTO test_user_id
  FROM auth.users
  WHERE email = 'test@example.com';
  
  -- Add admin role to test user
  IF test_user_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id)
    VALUES (test_user_id, admin_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
    
    -- Update user metadata
    UPDATE auth.users
    SET raw_user_meta_data = 
      COALESCE(raw_user_meta_data, '{}'::jsonb) || 
      '{"is_admin": true}'::jsonb
    WHERE id = test_user_id;
    
    RAISE NOTICE 'Admin role added to test@example.com';
  END IF;
END $$;