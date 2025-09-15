/*
  # Add Role-Based Authentication

  1. Changes
    - Add roles table for user role management
    - Add user_roles table for role assignments
    - Add role-based policies for different access levels
    - Add trigger for automatic role assignment
    
  2. Security
    - Enable RLS on new tables
    - Add policies for role-based access
    - Ensure proper role inheritance
*/

-- Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Create user_roles junction table
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role_id)
);

-- Enable RLS
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Roles are viewable by authenticated users"
  ON roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "User roles are viewable by authenticated users"
  ON user_roles FOR SELECT TO authenticated USING (true);

-- Insert default roles
INSERT INTO roles (name, description) VALUES
  ('admin', 'System administrator with full access'),
  ('therapist', 'Therapist with limited access to their own data'),
  ('receptionist', 'Front desk staff with basic access')
ON CONFLICT (name) DO NOTHING;

-- Create function to check user role (avoid creating in auth schema to prevent permission issues)
DO $$
BEGIN
  PERFORM 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app' AND p.proname = 'user_has_role' AND p.proargtypes = '25'::regtype::oid::oidvector; -- text arg

  IF NOT FOUND THEN
    EXECUTE $$
      CREATE OR REPLACE FUNCTION app.user_has_role(role_name text)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$
        select exists (
          select 1
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.user_id = (select auth.uid())
            and r.name = role_name
        );
      $$;
    $$;
  END IF;
END $$;

-- Create function to get user roles in app schema
DO $$
BEGIN
  PERFORM 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app' AND p.proname = 'get_user_roles' AND p.proargtypes = ''::oidvector;

  IF NOT FOUND THEN
    EXECUTE $$
      CREATE OR REPLACE FUNCTION app.get_user_roles()
      RETURNS text[]
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$
        select array(
          select r.name
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.user_id = (select auth.uid())
        );
      $$;
    $$;
  END IF;
END $$;

-- Update existing RLS policies to be role-aware

-- Therapists table
DROP POLICY IF EXISTS "Allow authenticated users to read all therapists" ON therapists;
CREATE POLICY "Therapists access control"
  ON therapists
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN id = auth.uid()
      ELSE false
    END
  );

-- Clients table
DROP POLICY IF EXISTS "Allow authenticated users to read all clients" ON clients;
CREATE POLICY "Clients access control"
  ON clients
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.client_id = clients.id
        AND s.therapist_id = auth.uid()
      )
      ELSE false
    END
  );

-- Sessions table
DROP POLICY IF EXISTS "Allow authenticated users to read all sessions" ON sessions;
CREATE POLICY "Sessions access control"
  ON sessions
  FOR ALL
  TO authenticated
  USING (
    CASE
      WHEN app.user_has_role('admin') THEN true
      WHEN app.user_has_role('therapist') THEN therapist_id = auth.uid()
      ELSE false
    END
  );

-- Create trigger for automatic role assignment
CREATE OR REPLACE FUNCTION auth.handle_new_user()
RETURNS trigger AS $$
DECLARE
  therapist_id uuid;
BEGIN
  -- Check if user is a therapist
  SELECT id INTO therapist_id FROM therapists WHERE email = NEW.email;
  
  IF therapist_id IS NOT NULL THEN
    -- Assign therapist role
    INSERT INTO user_roles (user_id, role_id)
    SELECT NEW.id, r.id FROM roles r WHERE r.name = 'therapist';
    
    -- Update therapist record with auth user id
    UPDATE therapists SET id = NEW.id WHERE email = NEW.email;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.handle_new_user();
