/*
  # Fix User Creation and Role Assignment

  1. Changes
    - Drop trigger before function
    - Recreate function with improved error handling
    - Add proper indexes
    - Ensure default roles exist
    
  2. Security
    - Maintain existing RLS policies
*/

-- First drop the trigger that depends on the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Now we can safely drop the function
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create improved handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  default_role_id uuid;
  is_therapist boolean;
BEGIN
  -- Get the default role (non-admin)
  SELECT id INTO default_role_id
  FROM roles
  WHERE name = 'therapist'
  LIMIT 1;

  -- Check if user is marked as therapist in metadata
  is_therapist := (NEW.raw_user_meta_data->>'is_therapist')::boolean;

  -- Create user role entry
  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, default_role_id);

  -- If user is a therapist, create therapist record
  IF is_therapist THEN
    INSERT INTO therapists (
      id,
      email,
      full_name,
      created_at
    ) VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      NOW()
    );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error details
    RAISE NOTICE 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_therapists_email ON therapists(email);

-- Ensure default roles exist
INSERT INTO roles (name, description)
VALUES 
  ('therapist', 'Therapist with limited access'),
  ('client', 'Client with basic access')
ON CONFLICT (name) DO NOTHING;