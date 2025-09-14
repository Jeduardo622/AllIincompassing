/*
  # Create Profiles Table with Role Column

  This migration creates the missing profiles table that the frontend authentication
  system expects. It includes:
  
  1. Creates role_type enum
  2. Creates profiles table with role column
  3. Syncs with existing user_roles junction table
  4. Creates triggers to keep both systems in sync
  5. Migrates existing users to profiles table
  
  The frontend expects profile.role but the backend uses user_roles junction table.
  This bridge keeps both systems working together.
*/

-- ============================================================================
-- STEP 1: CREATE ROLE_TYPE ENUM IF IT DOESN'T EXIST
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_type') THEN
    CREATE TYPE role_type AS ENUM ('client', 'therapist', 'admin', 'super_admin');
  END IF;
END $$;

-- ============================================================================
-- STEP 2: CREATE PROFILES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  role role_type NOT NULL DEFAULT 'client',
  first_name text,
  last_name text,
  full_name text GENERATED ALWAYS AS (
    CASE 
      WHEN first_name IS NOT NULL AND last_name IS NOT NULL 
      THEN first_name || ' ' || last_name
      ELSE COALESCE(first_name, last_name, email)
    END
  ) STORED,
  phone text,
  avatar_url text,
  time_zone text DEFAULT 'UTC',
  preferences jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 3: ENABLE RLS AND CREATE POLICIES
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
TO authenticated USING (id = auth.uid());

-- Users can update their own profile
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
TO authenticated USING (id = auth.uid());

-- Admins can view all profiles
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
TO authenticated USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'super_admin')
  )
);

-- Admins can update all profiles
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
TO authenticated USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'super_admin')
  )
);

-- Allow inserts during user creation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.polname = 'profiles_insert'
      AND c.relname = 'profiles'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE $$
      CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT
      TO authenticated WITH CHECK (true)
    $$;
  END IF;
END $$;

-- ============================================================================
-- STEP 4: CREATE FUNCTION TO GET ROLE FROM USER_ROLES
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_role_from_junction(p_user_id uuid)
RETURNS role_type AS $$
DECLARE
  user_role text;
BEGIN
  -- Get the highest role from user_roles (admin > therapist > client)
  SELECT r.name INTO user_role
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = p_user_id
  ORDER BY 
    CASE r.name
      WHEN 'super_admin' THEN 4
      WHEN 'admin' THEN 3
      WHEN 'therapist' THEN 2
      WHEN 'client' THEN 1
      ELSE 0
    END DESC
  LIMIT 1;
  
  -- Return the role or default to client
  RETURN COALESCE(user_role::role_type, 'client'::role_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 5: CREATE TRIGGERS TO SYNC PROFILES WITH USER_ROLES
-- ============================================================================

-- Trigger function to create/update profile when user is created
CREATE OR REPLACE FUNCTION sync_user_profile()
RETURNS trigger AS $$
BEGIN
  -- Insert or update profile with role from user_roles table
  INSERT INTO profiles (
    id, 
    email, 
    role, 
    first_name, 
    last_name, 
    phone,
    is_active,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    get_user_role_from_junction(NEW.id),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    role = get_user_role_from_junction(NEW.id),
    first_name = COALESCE(EXCLUDED.first_name, NEW.raw_user_meta_data->>'first_name'),
    last_name = COALESCE(EXCLUDED.last_name, NEW.raw_user_meta_data->>'last_name'),
    phone = COALESCE(EXCLUDED.phone, NEW.raw_user_meta_data->>'phone'),
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function to update profile role when user_roles changes
CREATE OR REPLACE FUNCTION sync_profile_role()
RETURNS trigger AS $$
BEGIN
  -- Update the profile role when user_roles changes
  UPDATE profiles 
  SET 
    role = get_user_role_from_junction(COALESCE(NEW.user_id, OLD.user_id)),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS sync_user_profile_trigger ON auth.users;
CREATE TRIGGER sync_user_profile_trigger
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_profile();

DROP TRIGGER IF EXISTS sync_profile_role_insert_trigger ON user_roles;
CREATE TRIGGER sync_profile_role_insert_trigger
  AFTER INSERT ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_role();

DROP TRIGGER IF EXISTS sync_profile_role_update_trigger ON user_roles;
CREATE TRIGGER sync_profile_role_update_trigger
  AFTER UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_role();

DROP TRIGGER IF EXISTS sync_profile_role_delete_trigger ON user_roles;
CREATE TRIGGER sync_profile_role_delete_trigger
  AFTER DELETE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_role();

-- ============================================================================
-- STEP 6: MIGRATE EXISTING USERS TO PROFILES TABLE
-- ============================================================================

-- Create profiles for all existing users
INSERT INTO profiles (id, email, role, is_active, created_at, updated_at)
SELECT 
  u.id,
  u.email,
  get_user_role_from_junction(u.id),
  true,
  u.created_at,
  NOW()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO UPDATE SET
  role = get_user_role_from_junction(EXCLUDED.id),
  updated_at = NOW();

-- ============================================================================
-- STEP 7: CREATE UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp ON profiles;
CREATE TRIGGER set_timestamp
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

-- ============================================================================
-- STEP 8: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_role_active ON profiles(role, is_active);

-- ============================================================================
-- STEP 9: GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role_from_junction(uuid) TO authenticated;

-- ============================================================================
-- STEP 10: ENSURE CURRENT USER HAS ADMIN ROLE
-- ============================================================================

DO $$
DECLARE
  current_user_id uuid;
  admin_role_id uuid;
BEGIN
  -- Get current authenticated user
  current_user_id := auth.uid();
  
  IF current_user_id IS NOT NULL THEN
    -- Get admin role ID
    SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
    
    IF admin_role_id IS NOT NULL THEN
      -- Assign admin role if not already assigned
      INSERT INTO user_roles (user_id, role_id)
      VALUES (current_user_id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
      
      -- Update profile to reflect admin role
      UPDATE profiles 
      SET 
        role = 'admin'::role_type,
        updated_at = NOW()
      WHERE id = current_user_id;
      
      RAISE NOTICE 'Admin role assigned to current user %', current_user_id;
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not assign admin role: %', SQLERRM;
END $$;
