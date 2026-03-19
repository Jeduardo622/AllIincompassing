/*
  # Add Admin Role Assignment Trigger

  1. Changes
    - Add trigger to automatically assign admin role to users with is_admin metadata
    - Update handle_new_user function to handle admin role assignment
    
  2. Security
    - Maintains existing RLS policies
    - Secure role assignment through trigger
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create improved handle_new_user function
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

  IF is_admin THEN
    -- Get admin role ID
    SELECT id INTO role_id
    FROM roles
    WHERE name = 'admin';
  ELSE
    -- Get therapist role ID (default)
    SELECT id INTO role_id
    FROM roles
    WHERE name = 'therapist';
  END IF;

  -- Create user role entry
  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, role_id);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();