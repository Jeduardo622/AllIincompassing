/*
  # Fix Role Assignment Functions

  1. New Functions
    - `assign_admin_role`: Improved function to assign admin role to a user by email
    - `get_user_roles`: Enhanced function to retrieve user roles with better error handling
  
  2. Security
    - Enable security definer for both functions to ensure they run with elevated privileges
    - Add proper error handling and logging
*/

-- Create or replace the assign_admin_role function with better error handling
CREATE OR REPLACE FUNCTION public.assign_admin_role(user_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id UUID;
  admin_role_id UUID;
BEGIN
  -- Get the user ID from the email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;
  
  -- Get the admin role ID
  SELECT id INTO admin_role_id
  FROM public.roles
  WHERE name = 'admin';
  
  IF admin_role_id IS NULL THEN
    -- Create the admin role if it doesn't exist
    INSERT INTO public.roles (name, description)
    VALUES ('admin', 'Administrator with full access')
    RETURNING id INTO admin_role_id;
  END IF;
  
  -- Check if the user already has the admin role
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = target_user_id AND role_id = admin_role_id
  ) THEN
    RETURN; -- User already has admin role
  END IF;
  
  -- Assign the admin role to the user
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (target_user_id, admin_role_id);
  
  -- Log the action
  RAISE NOTICE 'Admin role assigned to user %', user_email;
END;
$$;

-- Create or replace the get_user_roles function with better error handling
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (
  user_id UUID,
  roles TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_user_id UUID;
BEGIN
  -- Get the authenticated user ID
  auth_user_id := auth.uid();
  
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'No authenticated user found';
  END IF;
  
  -- Return the user's roles
  RETURN QUERY
  SELECT 
    auth_user_id,
    ARRAY_AGG(r.name)
  FROM 
    public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
  WHERE 
    ur.user_id = auth_user_id
  GROUP BY 
    1;
  
  -- If no roles found, return empty array
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 
      auth_user_id,
      ARRAY[]::TEXT[];
  END IF;
END;
$$;

-- Grant execute permissions on the functions
GRANT EXECUTE ON FUNCTION public.assign_admin_role(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_roles() TO authenticated;

-- Ensure the roles table exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'roles' AND schemaname = 'public') THEN
    CREATE TABLE public.roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    
    -- Insert default roles
    INSERT INTO public.roles (name, description)
    VALUES 
      ('admin', 'Administrator with full access'),
      ('therapist', 'Therapist with limited access');
  END IF;
  
  -- Ensure the user_roles table exists
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_roles' AND schemaname = 'public') THEN
    CREATE TABLE public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_id, role_id)
    );
    
    -- Create index for faster lookups
    CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
    CREATE INDEX idx_user_roles_role_id ON public.user_roles(role_id);
  END IF;
END;
$$;

-- Enable RLS on roles and user_roles tables
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create policies for roles table
CREATE POLICY "Roles are viewable by authenticated users"
ON public.roles
FOR SELECT
TO authenticated
USING (true);

-- Create policies for user_roles table
CREATE POLICY "User roles access control"
ON public.user_roles
FOR ALL
TO authenticated
USING (
  CASE
    WHEN auth.user_has_role('admin') THEN true
    ELSE user_id = auth.uid()
  END
);