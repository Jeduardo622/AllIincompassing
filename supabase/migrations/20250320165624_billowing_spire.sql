-- Create function to handle new user registration
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
  SELECT id INTO role_id
  FROM roles
  WHERE name = CASE WHEN is_admin THEN 'admin' ELSE 'therapist' END;

  -- Create user role entry
  INSERT INTO user_roles (user_id, role_id)
  VALUES (NEW.id, role_id);

  -- If admin, ensure metadata is properly set
  IF is_admin THEN
    UPDATE auth.users
    SET raw_user_meta_data = 
      COALESCE(raw_user_meta_data, '{}'::jsonb) || 
      '{"is_admin": true}'::jsonb
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Function to check admin status
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
    AND r.name = 'admin'
  );
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Fix any existing admin users that might have incorrect metadata
UPDATE auth.users u
SET raw_user_meta_data = 
  COALESCE(raw_user_meta_data, '{}'::jsonb) || 
  '{"is_admin": true}'::jsonb
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
WHERE ur.user_id = u.id
AND r.name = 'admin';