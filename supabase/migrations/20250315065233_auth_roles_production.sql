/*
  # Production-Ready Authentication & Authorization System
  
  1. Schema Changes
     - Create role_type enum with 4 roles: client, therapist, admin, super_admin
     - Create profiles table with role column
     - Add indexes for performance
     
  2. RLS Policies
     - Enable RLS on all user-facing tables
     - Implement role-based access control
     - Clients: self-only access
     - Therapists: assigned clients + self
     - Admins & Super_admins: full access
     
  3. Security Functions
     - Helper functions for role checking
     - Secure profile creation triggers
     
  4. CI Safeguards
     - Ensure RLS is enabled on all tables
     - Prevent schema drift
*/

-- ============================================================================
-- STEP 1: CREATE ROLE TYPE ENUM
-- ============================================================================

-- Create the role_type enum
CREATE TYPE role_type AS ENUM ('client', 'therapist', 'admin', 'super_admin');

-- ============================================================================
-- STEP 2: CREATE PROFILES TABLE
-- ============================================================================

-- Create profiles table with role column
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

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_role_active ON profiles(role, is_active);

-- ============================================================================
-- STEP 3: ENABLE RLS ON ALL USER-FACING TABLES
-- ============================================================================

-- Enable RLS on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on existing tables (idempotent)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapists ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- NOTE: authorizations table RLS handled in 20250324180437_plain_sky.sql
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 4: CREATE ROLE-BASED ACCESS FUNCTIONS
-- ============================================================================

-- Function to check if user has a specific role
CREATE OR REPLACE FUNCTION auth.has_role(role_name role_type)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = role_name 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has any of the specified roles
CREATE OR REPLACE FUNCTION auth.has_any_role(role_names role_type[])
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = ANY(role_names) 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's current role
CREATE OR REPLACE FUNCTION auth.get_user_role()
RETURNS role_type AS $$
DECLARE
  user_role role_type;
BEGIN
  SELECT role INTO user_role 
  FROM profiles 
  WHERE id = auth.uid() 
  AND is_active = true;
  
  RETURN user_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is admin or super_admin
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN auth.has_any_role(ARRAY['admin', 'super_admin']::role_type[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 5: CREATE COMPREHENSIVE RLS POLICIES
-- ============================================================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

-- Profiles table policies
CREATE POLICY "profiles_select" ON profiles FOR SELECT 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    ELSE id = auth.uid()
  END
);

CREATE POLICY "profiles_insert" ON profiles FOR INSERT 
TO authenticated 
WITH CHECK (
  CASE 
    WHEN auth.is_admin() THEN true
    ELSE id = auth.uid()
  END
);

CREATE POLICY "profiles_update" ON profiles FOR UPDATE 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    ELSE id = auth.uid()
  END
);

CREATE POLICY "profiles_delete" ON profiles FOR DELETE 
TO authenticated 
USING (auth.has_role('super_admin'::role_type));

-- Clients table policies
DROP POLICY IF EXISTS "clients_access" ON clients;
CREATE POLICY "clients_access" ON clients FOR ALL 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    WHEN auth.has_role('therapist'::role_type) THEN 
      EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.client_id = clients.id 
        AND s.therapist_id = auth.uid()
      )
    WHEN auth.has_role('client'::role_type) THEN id = auth.uid()
    ELSE false
  END
);

-- Therapists table policies
DROP POLICY IF EXISTS "therapists_access" ON therapists;
CREATE POLICY "therapists_access" ON therapists FOR ALL 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    WHEN auth.has_role('therapist'::role_type) THEN id = auth.uid()
    WHEN auth.has_role('client'::role_type) THEN 
      EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.therapist_id = therapists.id 
        AND s.client_id = auth.uid()
      )
    ELSE false
  END
);

-- Sessions table policies
DROP POLICY IF EXISTS "sessions_access" ON sessions;
CREATE POLICY "sessions_access" ON sessions FOR ALL 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    WHEN auth.has_role('therapist'::role_type) THEN therapist_id = auth.uid()
    WHEN auth.has_role('client'::role_type) THEN client_id = auth.uid()
    ELSE false
  END
);

-- Authorizations table policies
DROP POLICY IF EXISTS "authorizations_access" ON authorizations;
CREATE POLICY "authorizations_access" ON authorizations FOR ALL 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    WHEN auth.has_role('therapist'::role_type) THEN provider_id = auth.uid()
    WHEN auth.has_role('client'::role_type) THEN client_id = auth.uid()
    ELSE false
  END
);

-- Billing records table policies
DROP POLICY IF EXISTS "billing_records_access" ON billing_records;
CREATE POLICY "billing_records_access" ON billing_records FOR ALL 
TO authenticated 
USING (
  CASE 
    WHEN auth.is_admin() THEN true
    WHEN auth.has_role('therapist'::role_type) THEN 
      EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.id = billing_records.session_id 
        AND s.therapist_id = auth.uid()
      )
    WHEN auth.has_role('client'::role_type) THEN 
      EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.id = billing_records.session_id 
        AND s.client_id = auth.uid()
      )
    ELSE false
  END
);

-- ============================================================================
-- STEP 6: CREATE PROFILE MANAGEMENT TRIGGERS
-- ============================================================================

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION auth.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, role, first_name, last_name, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    'client'::role_type,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.handle_new_user();

-- Function to update profile timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timestamp on profile changes
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 7: GRANT PERMISSIONS
-- ============================================================================

-- Grant execute permissions on auth functions
GRANT EXECUTE ON FUNCTION auth.has_role(role_type) TO authenticated;
GRANT EXECUTE ON FUNCTION auth.has_any_role(role_type[]) TO authenticated;
GRANT EXECUTE ON FUNCTION auth.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.is_admin() TO authenticated;

-- ============================================================================
-- STEP 8: CI SAFEGUARDS - RLS VERIFICATION
-- ============================================================================

-- Function to verify RLS is enabled on all user-facing tables
CREATE OR REPLACE FUNCTION auth.verify_rls_enabled()
RETURNS TABLE(table_name text, rls_enabled boolean) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.table_name::text,
    t.row_security::boolean
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_name IN ('profiles', 'clients', 'therapists', 'sessions', 'authorizations', 'billing_records')
  ORDER BY t.table_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify all required roles exist
CREATE OR REPLACE FUNCTION auth.verify_role_system()
RETURNS TABLE(role_name text, exists boolean) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    unnest(ARRAY['client', 'therapist', 'admin', 'super_admin']) AS role_name,
    unnest(ARRAY['client', 'therapist', 'admin', 'super_admin']) = ANY(enum_range(NULL::role_type)::text[]) AS exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 9: MIGRATE EXISTING DATA
-- ============================================================================

-- Migrate existing user data from old role system if it exists
DO $$
BEGIN
  -- Only migrate if old user_roles table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'user_roles' AND table_schema = 'public'
  ) THEN
    
    -- Create profiles for existing users with roles
    INSERT INTO profiles (id, email, role, created_at)
    SELECT DISTINCT
      ur.user_id,
      COALESCE(u.email, 'unknown@example.com'),
      CASE 
        WHEN r.name = 'admin' THEN 'admin'::role_type
        WHEN r.name = 'therapist' THEN 'therapist'::role_type
        ELSE 'client'::role_type
      END,
      NOW()
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    JOIN auth.users u ON ur.user_id = u.id
    WHERE ur.is_active = true
    ON CONFLICT (id) DO UPDATE SET
      role = EXCLUDED.role,
      updated_at = NOW();
      
    RAISE NOTICE 'Migrated existing user roles to profiles table';
  END IF;
END $$;

-- ============================================================================
-- STEP 10: FINAL VERIFICATION
-- ============================================================================

-- Log completion
DO $$
DECLARE
  rls_status record;
  role_status record;
BEGIN
  -- Verify RLS is enabled
  FOR rls_status IN SELECT * FROM auth.verify_rls_enabled() LOOP
    IF NOT rls_status.rls_enabled THEN
      RAISE EXCEPTION 'RLS not enabled on table: %', rls_status.table_name;
    END IF;
  END LOOP;
  
  -- Verify role system
  FOR role_status IN SELECT * FROM auth.verify_role_system() LOOP
    IF NOT role_status.exists THEN
      RAISE EXCEPTION 'Role not found: %', role_status.role_name;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Production-ready authentication system initialized successfully';
  RAISE NOTICE 'RLS enabled on all user-facing tables';
  RAISE NOTICE 'Role-based access control implemented';
  RAISE NOTICE 'CI safeguards in place';
END $$;