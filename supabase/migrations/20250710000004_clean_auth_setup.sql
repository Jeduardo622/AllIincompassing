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