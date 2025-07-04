/*
  # Enable Therapist Role and User Links

  1. Creates therapist role if it doesn't exist
  2. Creates user-therapist link table for mapping users to therapists
  3. Adds security policies for proper access control
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
      SELECT id 
      FROM therapists 
      WHERE id = auth.uid()
    )
  );

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
GRANT EXECUTE ON FUNCTION get_user_therapist_id() TO authenticated;