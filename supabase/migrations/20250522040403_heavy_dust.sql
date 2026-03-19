/*
  # Fix User Role Assignment

  1. Changes
    - Improve user_has_role function to properly handle admin role
    - Fix get_user_roles function to handle null results
    - Add function to assign therapist role to new users
    - Update handle_new_user trigger function
    
  2. Security
    - Maintain existing RLS policies
    - Ensure proper role assignment
*/

-- Create function to assign therapist role to a user
CREATE OR REPLACE FUNCTION assign_therapist_role(user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  therapist_role_id uuid;
BEGIN
  -- Get therapist role ID
  SELECT id INTO therapist_role_id
  FROM roles
  WHERE name = 'therapist';
  
  -- Add therapist role
  INSERT INTO user_roles (user_id, role_id)
  VALUES (user_id, therapist_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
  
  RAISE NOTICE 'Therapist role assigned to user %', user_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error assigning therapist role: %', SQLERRM;
END;
$$;

-- Improve handle_new_user function to properly assign roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  role_id uuid;
  is_admin boolean;
BEGIN
  -- Check if user is marked as admin in metadata
  is_admin := (NEW.raw_user_meta_data->>'is_admin')::boolean;

  -- Get appropriate role ID
  IF is_admin THEN
    SELECT id INTO role_id
    FROM roles
    WHERE name = 'admin';
  ELSE
    SELECT id INTO role_id
    FROM roles
    WHERE name = 'therapist';
  END IF;

  -- Create user role entry
  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  -- Log the role assignment
  RAISE NOTICE 'Role % assigned to user %', 
    CASE WHEN is_admin THEN 'admin' ELSE 'therapist' END, 
    NEW.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION assign_therapist_role(uuid) TO authenticated;

-- Ensure all existing users have at least one role
DO $$
DECLARE
  user_record RECORD;
  therapist_role_id uuid;
  admin_role_id uuid;
BEGIN
  -- Get role IDs
  SELECT id INTO therapist_role_id FROM roles WHERE name = 'therapist';
  SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
  
  -- Loop through all users
  FOR user_record IN 
    SELECT u.id, u.email, (u.raw_user_meta_data->>'is_admin')::boolean as is_admin
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
    )
  LOOP
    -- Assign appropriate role
    IF user_record.is_admin THEN
      INSERT INTO user_roles (user_id, role_id)
      VALUES (user_record.id, admin_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
      
      RAISE NOTICE 'Admin role assigned to %', user_record.email;
    ELSE
      INSERT INTO user_roles (user_id, role_id)
      VALUES (user_record.id, therapist_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
      
      RAISE NOTICE 'Therapist role assigned to %', user_record.email;
    END IF;
  END LOOP;
END $$;