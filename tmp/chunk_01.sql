BEGIN;

-- BEGIN 20250315060000_enable_pgcrypto.sql

-- Ensure pgcrypto is available before any migrations rely on gen_salt/crypt
create extension if not exists pgcrypto with schema extensions;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250315060000','enable_pgcrypto') ON CONFLICT (version) DO NOTHING;

-- END 20250315060000_enable_pgcrypto.sql


-- BEGIN 20250701120000_admin_actions_add_organization.sql

/*
  # Add organization scope to admin action logs

  1. Changes
    - Add organization_id column to admin_actions for contextual auditing
    - Backfill existing rows to null-safe value
    - Update permissions metadata to acknowledge new column
*/

ALTER TABLE public.admin_actions
  ADD COLUMN IF NOT EXISTS organization_id UUID;

COMMENT ON COLUMN public.admin_actions.organization_id IS
  'Optional organization scope for admin action auditing';

CREATE INDEX IF NOT EXISTS admin_actions_organization_id_idx
  ON public.admin_actions (organization_id);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250701120000','admin_actions_add_organization') ON CONFLICT (version) DO NOTHING;

-- END 20250701120000_admin_actions_add_organization.sql


-- BEGIN 20250710000000_create_profiles_table.sql

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

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250710000000','create_profiles_table') ON CONFLICT (version) DO NOTHING;

-- END 20250710000000_create_profiles_table.sql


-- BEGIN 20250710000004_clean_auth_setup.sql

/*
  # Clean Auth Setup

  This migration cleans up auth.users conflicts and sets up proper authentication.
  Instead of manually inserting users, we'll set up the system to handle signups properly.
*/

-- Clean up any problematic data in auth tables
-- Remove duplicate or conflicting user entries
DELETE FROM auth.identities WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE email IN ('admin@test.com', 'superadmin@test.com', 'client@test.com', 'therapist@test.com')
);

DELETE FROM user_roles WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE email IN ('admin@test.com', 'superadmin@test.com', 'client@test.com', 'therapist@test.com')
);

DELETE FROM profiles WHERE email IN ('admin@test.com', 'superadmin@test.com', 'client@test.com', 'therapist@test.com');

DELETE FROM auth.users WHERE email IN ('admin@test.com', 'superadmin@test.com', 'client@test.com', 'therapist@test.com');

-- Create function to automatically assign admin role to specific emails
CREATE OR REPLACE FUNCTION assign_role_on_signup()
RETURNS trigger AS $$
DECLARE
  user_role_name text := 'client'; -- default role
  role_id uuid;
BEGIN
  -- Determine role based on email
  CASE NEW.email
    WHEN 'admin@test.com' THEN user_role_name := 'admin';
    WHEN 'superadmin@test.com' THEN user_role_name := 'super_admin';
    WHEN 'therapist@test.com' THEN user_role_name := 'therapist';
    WHEN 'j_eduardo622@yahoo.com' THEN user_role_name := 'admin';
    ELSE user_role_name := 'client';
  END CASE;

  -- Get role ID
  SELECT id INTO role_id FROM roles WHERE name = user_role_name;
  
  -- Assign role in user_roles table
  IF role_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id)
    VALUES (NEW.id, role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for automatic role assignment
DROP TRIGGER IF EXISTS assign_role_on_signup_trigger ON auth.users;
CREATE TRIGGER assign_role_on_signup_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION assign_role_on_signup();

-- Update existing profile sync trigger to handle the new role assignment
CREATE OR REPLACE FUNCTION sync_user_profile()
RETURNS trigger AS $$
DECLARE
  user_role_type text;
BEGIN
  -- Get user's role from user_roles table
  SELECT r.name INTO user_role_type
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = NEW.id
  ORDER BY 
    CASE r.name
      WHEN 'super_admin' THEN 4
      WHEN 'admin' THEN 3
      WHEN 'therapist' THEN 2
      WHEN 'client' THEN 1
      ELSE 0
    END DESC
  LIMIT 1;
  
  -- Default to client if no role found
  IF user_role_type IS NULL THEN
    user_role_type := 'client';
  END IF;

  -- Insert or update profile
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
    user_role_type::role_type,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    role = user_role_type::role_type,
    first_name = COALESCE(profiles.first_name, NEW.raw_user_meta_data->>'first_name'),
    last_name = COALESCE(profiles.last_name, NEW.raw_user_meta_data->>'last_name'),
    phone = COALESCE(profiles.phone, NEW.raw_user_meta_data->>'phone'),
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the sync trigger
DROP TRIGGER IF EXISTS sync_user_profile_trigger ON auth.users;
CREATE TRIGGER sync_user_profile_trigger
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_profile();

DO $$
BEGIN
  RAISE NOTICE '=== AUTH SYSTEM CLEANED UP ===';
  RAISE NOTICE 'You can now sign up normally with these emails to get the appropriate roles:';
  RAISE NOTICE '- admin@test.com -> admin role';
  RAISE NOTICE '- superadmin@test.com -> super_admin role'; 
  RAISE NOTICE '- therapist@test.com -> therapist role';
  RAISE NOTICE '- j_eduardo622@yahoo.com -> admin role';
  RAISE NOTICE '- any other email -> client role';
  RAISE NOTICE 'Use any password you want during signup.';
  RAISE NOTICE '=================================';
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250710000004','clean_auth_setup') ON CONFLICT (version) DO NOTHING;

-- END 20250710000004_clean_auth_setup.sql


-- BEGIN 20250711090000_session_holds.sql

-- Session hold infrastructure for transactional scheduling
set search_path = public;

create extension if not exists btree_gist;

create table if not exists session_holds (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references therapists(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  hold_key uuid not null unique,
  session_id uuid null references sessions(id) on delete set null,
  expires_at timestamptz not null default timezone('utc', now()) + interval '5 minutes',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists session_holds_therapist_start_time_idx
  on session_holds (therapist_id, start_time);

create index if not exists session_holds_expires_at_idx
  on session_holds (expires_at);

alter table session_holds
  add constraint session_holds_therapist_time_excl
    exclude using gist (
      therapist_id with =,
      tstzrange(start_time, end_time, '[)') with &&
    );

alter table session_holds
  add constraint session_holds_client_time_excl
    exclude using gist (
      client_id with =,
      tstzrange(start_time, end_time, '[)') with &&
    );

alter table session_holds enable row level security;

create policy if not exists "session_holds_disallow_select"
  on session_holds
  for select
  using (false);

create policy if not exists "session_holds_disallow_insert"
  on session_holds
  for insert
  with check (false);

create policy if not exists "session_holds_disallow_update"
  on session_holds
  for update
  using (false)
  with check (false);

create policy if not exists "session_holds_disallow_delete"
  on session_holds
  for delete
  using (false);

create or replace function acquire_session_hold(
  p_therapist_id uuid,
  p_client_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_session_id uuid default null,
  p_hold_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold session_holds;
  v_constraint_name text;
begin
  delete from session_holds where expires_at <= timezone('utc', now());

  if p_start_time >= p_end_time then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_RANGE',
      'error_message', 'End time must be after start time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.therapist_id = p_therapist_id
      and (p_session_id is null or s.id <> p_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_CONFLICT',
      'error_message', 'Therapist already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.client_id = p_client_id
      and (p_session_id is null or s.id <> p_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_CONFLICT',
      'error_message', 'Client already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from session_holds h
    where h.therapist_id = p_therapist_id
      and h.expires_at > timezone('utc', now())
      and tstzrange(h.start_time, h.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_HOLD_CONFLICT',
      'error_message', 'Therapist already has a hold during this time.'
    );
  end if;

  if exists (
    select 1
    from session_holds h
    where h.client_id = p_client_id
      and h.expires_at > timezone('utc', now())
      and tstzrange(h.start_time, h.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_HOLD_CONFLICT',
      'error_message', 'Client already has a hold during this time.'
    );
  end if;

  begin
    insert into session_holds (
      therapist_id,
      client_id,
      start_time,
      end_time,
      session_id,
      expires_at
    )
    values (
      p_therapist_id,
      p_client_id,
      p_start_time,
      p_end_time,
      p_session_id,
      timezone('utc', now()) + make_interval(secs => coalesce(p_hold_seconds, 300))
    )
    returning * into v_hold;
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', false,
        'error_code', 'HOLD_EXISTS',
        'error_message', 'A hold already exists for this time.'
      );
    when exclusion_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'session_holds_therapist_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'THERAPIST_HOLD_CONFLICT',
          'error_message', 'Therapist already has a hold during this time.'
        );
      elsif v_constraint_name = 'session_holds_client_time_excl' then
        return jsonb_build_object(
          'success', false,
          'error_code', 'CLIENT_HOLD_CONFLICT',
          'error_message', 'Client already has a hold during this time.'
        );
      else
        raise;
      end if;
  end;

  return jsonb_build_object(
    'success', true,
    'hold', row_to_json(v_hold)
  );
end;
$$;

create or replace function confirm_session_hold(
  p_hold_key uuid,
  p_session jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold session_holds;
  v_session sessions;
  v_session_id uuid;
  v_therapist_id uuid;
  v_client_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_notes text;
  v_location text;
  v_session_type text;
  v_rate numeric;
  v_total numeric;
  v_cpt_increment constant integer := 15;
  v_raw_duration numeric;
  v_duration integer;
begin
  delete from session_holds where expires_at <= timezone('utc', now());

  select *
    into v_hold
    from session_holds
   where hold_key = p_hold_key
   for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_NOT_FOUND',
      'error_message', 'Hold has expired or does not exist.'
    );
  end if;

  v_session_id := nullif(p_session->>'id', '')::uuid;
  v_therapist_id := nullif(p_session->>'therapist_id', '')::uuid;
  v_client_id := nullif(p_session->>'client_id', '')::uuid;
  v_start := nullif(p_session->>'start_time', '')::timestamptz;
  v_end := nullif(p_session->>'end_time', '')::timestamptz;
  v_status := coalesce(nullif(p_session->>'status', ''), 'scheduled');
  v_notes := nullif(p_session->>'notes', '');
  v_location := nullif(p_session->>'location_type', '');
  v_session_type := nullif(p_session->>'session_type', '');
  v_rate := nullif(p_session->>'rate_per_hour', '')::numeric;
  v_total := nullif(p_session->>'total_cost', '')::numeric;
  v_raw_duration := coalesce(
    nullif(p_session->>'duration_minutes', '')::numeric,
    (extract(epoch from (v_end - v_start)) / 60)::numeric
  );

  -- CPT codes require reporting in quarter-hour increments; round the raw duration
  -- instead of truncating so billing receives the compliant value.
  v_duration := greatest(
    v_cpt_increment,
    (round(v_raw_duration / v_cpt_increment)::int) * v_cpt_increment
  );

  if v_therapist_id is null or v_client_id is null or v_start is null or v_end is null then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_FIELDS',
      'error_message', 'Missing required session fields.'
    );
  end if;

  if v_hold.therapist_id <> v_therapist_id or v_hold.start_time <> v_start or v_hold.end_time <> v_end then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_MISMATCH',
      'error_message', 'Session details do not match the held slot.'
    );
  end if;

  if v_hold.client_id <> v_client_id then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_MISMATCH',
      'error_message', 'Client differs from the hold.'
    );
  end if;

  if v_hold.expires_at <= timezone('utc', now()) then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'HOLD_EXPIRED',
      'error_message', 'Hold has expired.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.therapist_id = v_therapist_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'THERAPIST_CONFLICT',
      'error_message', 'Therapist already has a session during this time.'
    );
  end if;

  if exists (
    select 1
    from sessions s
    where s.client_id = v_client_id
      and (v_session_id is null or s.id <> v_session_id)
      and s.status <> 'cancelled'
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) then
    delete from session_holds where id = v_hold.id;
    return jsonb_build_object(
      'success', false,
      'error_code', 'CLIENT_CONFLICT',
      'error_message', 'Client already has a session during this time.'
    );
  end if;

  if v_session_id is null then
    insert into sessions (
      therapist_id,
      client_id,
      start_time,
      end_time,
      status,
      notes,
      location_type,
      session_type,
      rate_per_hour,
      total_cost,
      duration_minutes
    )
    values (
      v_therapist_id,
      v_client_id,
      v_start,
      v_end,
      v_status,
      v_notes,
      v_location,
      v_session_type,
      v_rate,
      v_total,
      v_duration
    )
    returning * into v_session;
  else
    update sessions
       set therapist_id = v_therapist_id,
           client_id = v_client_id,
           start_time = v_start,
           end_time = v_end,
           status = v_status,
           notes = v_notes,
           location_type = v_location,
           session_type = v_session_type,
           rate_per_hour = v_rate,
           total_cost = v_total,
           duration_minutes = v_duration
     where id = v_session_id
     returning * into v_session;
  end if;

  delete from session_holds where id = v_hold.id;

  return jsonb_build_object(
    'success', true,
    'session', row_to_json(v_session)
  );
end;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250711090000','session_holds') ON CONFLICT (version) DO NOTHING;

-- END 20250711090000_session_holds.sql


-- BEGIN 20250713000000_secure_org_rls.sql

/*
  # Tighten RLS policies for therapy domain tables

  1. Policies
    - Scope therapist access to their own row via auth.uid()
    - Require therapists to share clients/sessions via session ownership
    - Limit billing record visibility to the session's therapist
    - Ensure role-aware policies enforce the same checks on writes
*/

-- Replace base therapist policy
DROP POLICY IF EXISTS "Therapists are viewable by authenticated users" ON therapists;
CREATE POLICY "Therapists are viewable by authenticated users"
  ON therapists
  FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Replace base client policy
DROP POLICY IF EXISTS "Clients are viewable by authenticated users" ON clients;
CREATE POLICY "Clients are viewable by authenticated users"
  ON clients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.client_id = clients.id
        AND s.therapist_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.client_id = clients.id
        AND s.therapist_id = auth.uid()
    )
  );

-- Replace base sessions policy
DROP POLICY IF EXISTS "Sessions are viewable by authenticated users" ON sessions;
CREATE POLICY "Sessions are viewable by authenticated users"
  ON sessions
  FOR ALL
  TO authenticated
  USING (therapist_id = auth.uid())
  WITH CHECK (therapist_id = auth.uid());

-- Replace base billing policy
DROP POLICY IF EXISTS "Billing records are viewable by authenticated users" ON billing_records;
CREATE POLICY "Billing records are viewable by authenticated users"
  ON billing_records
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.id = billing_records.session_id
        AND s.therapist_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.id = billing_records.session_id
        AND s.therapist_id = auth.uid()
    )
  );

-- Recreate role-aware therapist policy with WITH CHECK
DROP POLICY IF EXISTS "Therapists access control" ON therapists;
CREATE POLICY "Therapists access control"
  ON therapists
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN id = auth.uid()
      ELSE false
    END
  );

-- Recreate role-aware client policy with WITH CHECK
DROP POLICY IF EXISTS "Clients access control" ON clients;
CREATE POLICY "Clients access control"
  ON clients
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = clients.id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = clients.id
          AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

-- Recreate role-aware sessions policy with WITH CHECK
DROP POLICY IF EXISTS "Sessions access control" ON sessions;
CREATE POLICY "Sessions access control"
  ON sessions
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN therapist_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN therapist_id = auth.uid()
      ELSE false
    END
  );

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250713000000','secure_org_rls') ON CONFLICT (version) DO NOTHING;

-- END 20250713000000_secure_org_rls.sql


-- BEGIN 20250715090000_secure_telemetry_rls.sql

/*
  # Secure telemetry datasets with admin-only RLS

  1. Security
    - Enables RLS on telemetry/monitoring tables
    - Restricts table access to admin, super_admin, or monitoring roles
    - Adds a security definer RPC for logging application errors
*/

DO $$
DECLARE
  telemetry_tables text[] := ARRAY[
    'ai_performance_metrics',
    'db_performance_metrics',
    'system_performance_metrics',
    'performance_alerts',
    'performance_baselines',
    'error_logs',
    'function_performance_logs',
    'ai_processing_logs'
  ];
  target_table text;
  policy_condition text :=
    'auth.user_has_role(''admin'') OR auth.user_has_role(''super_admin'') OR auth.user_has_role(''monitoring'')';
BEGIN
  FOREACH target_table IN ARRAY telemetry_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = target_table
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', target_table);

      EXECUTE format('DROP POLICY IF EXISTS %I_admin_manage ON public.%I;', target_table || '_admin_manage', target_table);
      EXECUTE format(
        'CREATE POLICY %I_admin_manage
           ON public.%I
           FOR ALL
           TO authenticated
           USING (%s)
           WITH CHECK (%s);',
        target_table || '_admin_manage',
        target_table,
        policy_condition,
        policy_condition
      );
    ELSE
      RAISE NOTICE 'Telemetry table % not found, skipping RLS policy.', target_table;
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.log_error_event(text, text, text, jsonb, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.log_error_event(
  p_error_type text,
  p_message text,
  p_stack_trace text DEFAULT NULL,
  p_context jsonb DEFAULT NULL,
  p_details jsonb DEFAULT NULL,
  p_severity text DEFAULT 'medium',
  p_url text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.error_logs (
    id,
    error_type,
    message,
    stack_trace,
    context,
    details,
    severity,
    url,
    user_agent,
    created_at,
    updated_at,
    user_id,
    resolved,
    resolved_at,
    resolved_by
  )
  VALUES (
    gen_random_uuid(),
    p_error_type,
    p_message,
    p_stack_trace,
    p_context,
    p_details,
    COALESCE(NULLIF(trim(p_severity), ''), 'medium'),
    p_url,
    p_user_agent,
    timezone('UTC', now()),
    timezone('UTC', now()),
    auth.uid(),
    false,
    NULL,
    NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_error_event(
  text,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text
) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250715090000','secure_telemetry_rls') ON CONFLICT (version) DO NOTHING;

-- END 20250715090000_secure_telemetry_rls.sql


-- BEGIN 20250715103000_secure_ai_cache_rls.sql

/*
  # Harden AI cache and performance log access

  ## Security
  - Enable row level security for ai_response_cache and function_performance_logs
  - Restrict table access to admins (including super_admins) and the service role
*/

-- Ensure row level security is enforced on ai_response_cache
ALTER TABLE IF EXISTS public.ai_response_cache ENABLE ROW LEVEL SECURITY;

-- Replace any prior policies with admin/service-role specific ones
DROP POLICY IF EXISTS ai_response_cache_admin_manage ON public.ai_response_cache;
DROP POLICY IF EXISTS "Admins manage ai response cache" ON public.ai_response_cache;
DROP POLICY IF EXISTS ai_response_cache_admin_select ON public.ai_response_cache;
DROP POLICY IF EXISTS ai_response_cache_service_role_manage ON public.ai_response_cache;
DROP POLICY IF EXISTS "Service role manages ai response cache" ON public.ai_response_cache;

CREATE POLICY ai_response_cache_admin_manage
  ON public.ai_response_cache
  FOR ALL
  TO authenticated
  USING (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  )
  WITH CHECK (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  );

CREATE POLICY ai_response_cache_service_role_manage
  ON public.ai_response_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure row level security is enforced on function_performance_logs
ALTER TABLE IF EXISTS public.function_performance_logs ENABLE ROW LEVEL SECURITY;

-- Replace existing telemetry policies with admin/service-role only access
DROP POLICY IF EXISTS function_performance_logs_admin_manage ON public.function_performance_logs;
DROP POLICY IF EXISTS "function_performance_logs_admin_manage" ON public.function_performance_logs;
DROP POLICY IF EXISTS function_performance_logs_admin_read ON public.function_performance_logs;
DROP POLICY IF EXISTS function_performance_logs_service_role_manage ON public.function_performance_logs;

CREATE POLICY function_performance_logs_admin_manage
  ON public.function_performance_logs
  FOR ALL
  TO authenticated
  USING (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  )
  WITH CHECK (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  );

CREATE POLICY function_performance_logs_service_role_manage
  ON public.function_performance_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250715103000','secure_ai_cache_rls') ON CONFLICT (version) DO NOTHING;

-- END 20250715103000_secure_ai_cache_rls.sql


-- BEGIN 20250720121500_secure_session_holds_rls.sql

-- Adjust session_holds RLS to allow admins full access and therapists scoped to their holds
set search_path = public;

drop policy if exists "session_holds_disallow_select" on session_holds;
drop policy if exists "session_holds_disallow_insert" on session_holds;
drop policy if exists "session_holds_disallow_update" on session_holds;
drop policy if exists "session_holds_disallow_delete" on session_holds;

create policy "session_holds_select_access"
  on session_holds
  for select
  to authenticated
  using (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

create policy "session_holds_insert_access"
  on session_holds
  for insert
  to authenticated
  with check (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

create policy "session_holds_update_access"
  on session_holds
  for update
  to authenticated
  using (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  )
  with check (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

create policy "session_holds_delete_access"
  on session_holds
  for delete
  to authenticated
  using (
    auth.user_has_role('admin')
    or (auth.user_has_role('therapist') and therapist_id = auth.uid())
  );

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250720121500','secure_session_holds_rls') ON CONFLICT (version) DO NOTHING;

-- END 20250720121500_secure_session_holds_rls.sql


-- BEGIN 20250722120000_scope_admin_users.sql

/*
  # Scope admin user listing by organization

  1. Changes
    - Recreate admin_users view with organization-aware filtering
    - Reintroduce get_admin_users(organization_id uuid) RPC enforcing org scoping
  2. Security
    - Restrict results to the caller's organization using metadata helper
    - Raise insufficient_privilege errors for unauthorized access attempts
*/

-- Drop the existing function before recreating dependencies
DROP FUNCTION IF EXISTS get_admin_users();

-- Recreate the admin_users view with security barrier and organization scoping
CREATE OR REPLACE VIEW admin_users
WITH (security_barrier = true) AS
SELECT
  u.id AS id,
  ur.id AS user_role_id,
  u.id AS user_id,
  u.email,
  u.raw_user_meta_data,
  u.created_at
FROM auth.users AS u
JOIN user_roles AS ur
  ON ur.user_id = u.id
JOIN roles AS r
  ON r.id = ur.role_id
WHERE r.name = 'admin'
  AND EXISTS (
    SELECT 1
    FROM user_roles AS ur2
    JOIN roles AS r2
      ON r2.id = ur2.role_id
    WHERE ur2.user_id = auth.uid()
      AND r2.name = 'admin'
  )
  AND get_organization_id_from_metadata(u.raw_user_meta_data) IS NOT NULL
  AND get_organization_id_from_metadata(u.raw_user_meta_data) = (
    SELECT get_organization_id_from_metadata(caller.raw_user_meta_data)
    FROM auth.users AS caller
    WHERE caller.id = auth.uid()
  );

-- Recreate the RPC with explicit organization scoping enforcement
CREATE OR REPLACE FUNCTION get_admin_users(organization_id uuid)
RETURNS SETOF admin_users
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid;
  caller_org_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;

  IF organization_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization ID is required';
  END IF;

  SELECT get_organization_id_from_metadata(u.raw_user_meta_data)
  INTO caller_org_id
  FROM auth.users AS u
  WHERE u.id = current_user_id;

  IF caller_org_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller is not associated with an organization';
  END IF;

  IF caller_org_id <> organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Caller organization mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles AS ur
    JOIN roles AS r ON r.id = ur.role_id
    WHERE ur.user_id = current_user_id
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators can view admin users';
  END IF;

  RETURN QUERY
  SELECT au.*
  FROM admin_users AS au
  WHERE get_organization_id_from_metadata(au.raw_user_meta_data) = organization_id;
END;
$$;

-- Ensure authenticated users (with appropriate RLS) can access the secured view and RPC
GRANT SELECT ON admin_users TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_users(uuid) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20250722120000','scope_admin_users') ON CONFLICT (version) DO NOTHING;

-- END 20250722120000_scope_admin_users.sql


COMMIT;