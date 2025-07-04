/*
  # Fix assign_therapist_role function and user_therapist_links table

  1. New Tables
    - `user_therapist_links` - Links users to their therapist profiles
  
  2. New Functions
    - `assign_therapist_role` - Assigns therapist role to a user and links them to a therapist profile
  
  3. Security
    - Enable RLS on user_therapist_links table
    - Create policy for admin access to user_therapist_links
*/

-- Function to assign therapist role to a user and associate with a specific therapist
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
  
  -- Create therapist role if it doesn't exist
  IF therapist_role_id IS NULL THEN
    INSERT INTO roles(name, description)
    VALUES ('therapist', 'Therapist role with limited permissions')
    RETURNING id INTO therapist_role_id;
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
  
  -- Check if therapist already exists
  SELECT COUNT(*) INTO existing_therapist_link_count
  FROM user_therapist_links
  WHERE user_id = target_user_id;
  
  -- Create user_therapist_links table if it doesn't exist
  CREATE TABLE IF NOT EXISTS user_therapist_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    therapist_id UUID NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, therapist_id)
  );
  
  -- Enable RLS
  ALTER TABLE user_therapist_links ENABLE ROW LEVEL SECURITY;
  
  -- Create policy using DROP/CREATE instead of IF NOT EXISTS
  DROP POLICY IF EXISTS "Admins can manage user-therapist links" ON user_therapist_links;
  CREATE POLICY "Admins can manage user-therapist links"
    ON user_therapist_links
    USING (auth.uid() IN (SELECT user_id FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE r.name = 'admin'));
  
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION assign_therapist_role(TEXT, UUID) TO authenticated;