-- Create function to handle new user registration with proper role assignment
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
  WHERE name = CASE 
    WHEN is_admin THEN 'admin'
    ELSE 'therapist'
  END;

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

-- Function to check user roles
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (roles text[]) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT ARRAY_AGG(r.name)::text[]
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = auth.uid()
  GROUP BY ur.user_id;
END;
$$;

-- Fix any existing role assignments
DO $$
DECLARE
  admin_role_id uuid;
  therapist_role_id uuid;
BEGIN
  -- Get role IDs
  SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
  SELECT id INTO therapist_role_id FROM roles WHERE name = 'therapist';

  -- Fix admin users
  INSERT INTO user_roles (user_id, role_id)
  SELECT u.id, admin_role_id
  FROM auth.users u
  WHERE (u.raw_user_meta_data->>'is_admin')::boolean = true
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = admin_role_id
  );

  -- Fix therapist users
  INSERT INTO user_roles (user_id, role_id)
  SELECT u.id, therapist_role_id
  FROM auth.users u
  WHERE (u.raw_user_meta_data->>'is_admin')::boolean IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id
  );
END $$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.get_user_roles() TO authenticated;