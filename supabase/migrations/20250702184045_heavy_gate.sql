/*
  # Enable Therapist Role and User-Therapist Linking

  1. New Functions
    - `assign_therapist_role`: Assigns therapist role to users and links them to a therapist record
    - `get_user_therapist_id`: Helper function to get the current user's therapist ID
  
  2. Tables
    - Creates `user_therapist_links` table if it doesn't exist
  
  3. Security
    - Sets up appropriate RLS policies
    - Ensures therapist role exists
*/

-- Ensure therapist role exists
INSERT INTO roles(name, description)
SELECT 'therapist', 'Therapist role with limited permissions'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'therapist');

-- Create user_therapist_links table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_therapist_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  therapist_id UUID NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, therapist_id)
);

-- Enable row level security
ALTER TABLE user_therapist_links ENABLE ROW LEVEL SECURITY;

-- Create access policies
DROP POLICY IF EXISTS "Admins can manage user-therapist links" ON user_therapist_links;
CREATE POLICY "Admins can manage user-therapist links"
  ON user_therapist_links
  USING (
    auth.uid() IN (
      SELECT user_id 
      FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE r.name = 'admin'
    )
  );

-- Create policy for therapists to view their own links
DROP POLICY IF EXISTS "Therapists can view their own links" ON user_therapist_links;
CREATE POLICY "Therapists can view their own links"
  ON user_therapist_links
  FOR SELECT
  USING (
    therapist_id IN (
      SELECT therapists.id
      FROM therapists
      WHERE therapists.id = auth.uid()
    )
  );

-- Function to assign therapist role to a user
CREATE OR REPLACE FUNCTION assign_therapist_role(
  user_email TEXT,
  therapist_id UUID
) 
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  therapist_role_id UUID;
  existing_role_count INT;
  existing_therapist_link_count INT;
BEGIN
  -- Get user ID from email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Get therapist role ID
  SELECT id INTO therapist_role_id
  FROM roles
  WHERE name = 'therapist';
  
  -- Ensure therapist role exists (should already be created above)
  IF therapist_role_id IS NULL THEN
    RAISE EXCEPTION 'Therapist role not found';
  END IF;

  -- Check if user already has therapist role
  SELECT COUNT(*) INTO existing_role_count
  FROM user_roles
  WHERE user_id = target_user_id AND role_id = therapist_role_id;
  
  -- Assign therapist role if not already assigned
  IF existing_role_count = 0 THEN
    INSERT INTO user_roles(user_id, role_id)
    VALUES (target_user_id, therapist_role_id);
  END IF;
  
  -- Check if therapist link already exists
  SELECT COUNT(*) INTO existing_therapist_link_count
  FROM user_therapist_links
  WHERE user_id = target_user_id;
  
  -- Insert or update therapist link
  IF existing_therapist_link_count = 0 THEN
    INSERT INTO user_therapist_links(user_id, therapist_id)
    VALUES (target_user_id, therapist_id);
  ELSE
    UPDATE user_therapist_links
    SET therapist_id = therapist_id
    WHERE user_id = target_user_id;
  END IF;
END;
$$;

-- Function to get therapist ID for current user
CREATE OR REPLACE FUNCTION get_user_therapist_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  therapist_id UUID;
BEGIN
  -- Try to get from user_therapist_links
  SELECT utl.therapist_id INTO therapist_id
  FROM user_therapist_links utl
  WHERE utl.user_id = auth.uid();
  
  -- If not found and user has therapist role, try to get from user metadata
  IF therapist_id IS NULL THEN
    SELECT ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'therapist_id')::UUID INTO therapist_id;
  END IF;
  
  RETURN therapist_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION assign_therapist_role(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_therapist_id() TO authenticated;