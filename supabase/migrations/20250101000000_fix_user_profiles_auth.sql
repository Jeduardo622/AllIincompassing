/*
# Fix User Profiles Authentication System

This migration fixes the database schema to support the frontend authentication system.

1. Creates/fixes the `profiles` table that the frontend expects
2. Sets up proper triggers for user creation
3. Fixes role assignment for super admins
4. Ensures data consistency
*/

-- ============================================================================
-- CREATE PROFILES TABLE IF NOT EXISTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client', 'therapist', 'admin', 'super_admin')) DEFAULT 'client',
  first_name TEXT,
  last_name TEXT,
  full_name TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN first_name IS NOT NULL AND last_name IS NOT NULL 
      THEN first_name || ' ' || last_name
      WHEN first_name IS NOT NULL 
      THEN first_name
      WHEN last_name IS NOT NULL 
      THEN last_name
      ELSE email
    END
  ) STORED,
  phone TEXT,
  avatar_url TEXT,
  time_zone TEXT DEFAULT 'America/New_York',
  preferences JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_role_active ON profiles(role, is_active);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TRIGGER FUNCTION FOR PROFILE CREATION
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  user_role TEXT := 'client';
  user_first_name TEXT;
  user_last_name TEXT;
BEGIN
  -- Extract user data from raw_user_meta_data
  user_first_name := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
  user_last_name := COALESCE(NEW.raw_user_meta_data->>'last_name', '');
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'client');
  
  -- Insert profile
  INSERT INTO profiles (
    id,
    email,
    role,
    first_name,
    last_name,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    user_role,
    NULLIF(user_first_name, ''),
    NULLIF(user_last_name, ''),
    NOW(),
    NOW()
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

-- Profiles table policies
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  USING (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "profiles_delete" ON profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role = 'super_admin'
    )
  );

-- ============================================================================
-- MIGRATE DATA FROM USER_PROFILES IF EXISTS
-- ============================================================================

DO $$
BEGIN
  -- Check if user_profiles table exists and migrate data
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
    INSERT INTO profiles (
      id, email, role, first_name, last_name, phone, is_active, created_at, updated_at
    )
    SELECT 
      id,
      email,
      COALESCE(role, 'client')::TEXT,
      first_name,
      last_name,
      phone,
      COALESCE(is_active, true),
      COALESCE(created_at, NOW()),
      COALESCE(updated_at, NOW())
    FROM user_profiles
    WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = user_profiles.id);
    
    RAISE NOTICE 'Migrated data from user_profiles to profiles table';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'No user_profiles table found or migration failed: %', SQLERRM;
END $$;

-- ============================================================================
-- CREATE SUPER ADMIN FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION create_super_admin(user_email TEXT)
RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  user_id UUID;
  actor_role TEXT;
  actor_id UUID;
BEGIN
  actor_role := current_setting('request.jwt.claim.role', true);

  IF actor_role IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'create_super_admin requires a role claim';
  ELSIF actor_role <> 'super_admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only super_admins may call create_super_admin';
  END IF;

  actor_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;

  -- Get user ID by email
  SELECT au.id INTO user_id
  FROM auth.users au
  WHERE au.email = user_email;

  IF user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;

  -- Update user role to super_admin
  UPDATE profiles
  SET role = 'super_admin', updated_at = TIMEZONE('utc'::text, NOW())
  WHERE id = user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile for user % not found', user_email;
  END IF;

  INSERT INTO admin_actions (
    action_type,
    admin_user_id,
    target_user_id,
    action_details
  )
  VALUES (
    'super_admin_promotion',
    actor_id,
    user_id,
    jsonb_build_object(
      'reason', format('Manual promotion of %s to super_admin via create_super_admin', user_email),
      'performed_at', TIMEZONE('utc'::text, NOW())
    )
  );

  RAISE NOTICE 'User % promoted to super_admin', user_email;
END;
$$;

-- Restrict execute permission to trusted roles only
REVOKE EXECUTE ON FUNCTION create_super_admin(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_super_admin(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_super_admin(TEXT) TO service_role;

-- ============================================================================
-- ENSURE EXISTING USERS HAVE PROFILES
-- ============================================================================

DO $$
DECLARE
  user_record RECORD;
BEGIN
  FOR user_record IN 
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = au.id)
  LOOP
    INSERT INTO profiles (
      id,
      email,
      role,
      first_name,
      last_name,
      created_at,
      updated_at
    ) VALUES (
      user_record.id,
      user_record.email,
      COALESCE(user_record.raw_user_meta_data->>'role', 'client'),
      user_record.raw_user_meta_data->>'first_name',
      user_record.raw_user_meta_data->>'last_name',
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created profile for existing user: %', user_record.email;
  END LOOP;
END $$;