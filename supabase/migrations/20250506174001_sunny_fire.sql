/*
  # Add Therapist Certifications Table

  1. New Tables
    - `therapist_certifications`
      - Track therapist certifications and credentials
      - Store certification details and expiration dates
      - Manage certification files and status
    
  2. Security
    - Enable RLS
    - Add policies for role-based access
*/

-- Create therapist_certifications table
CREATE TABLE IF NOT EXISTS therapist_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid REFERENCES therapists(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  issue_date date NOT NULL,
  expiry_date date,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT therapist_certifications_status_check CHECK (
    status IN ('active', 'expired', 'pending')
  )
);

-- Enable RLS
ALTER TABLE therapist_certifications ENABLE ROW LEVEL SECURITY;

-- Create indexes with IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_therapist_certifications_therapist_id ON therapist_certifications(therapist_id);
CREATE INDEX IF NOT EXISTS idx_therapist_certifications_status ON therapist_certifications(status);
CREATE INDEX IF NOT EXISTS idx_therapist_certifications_expiry_date ON therapist_certifications(expiry_date);

-- Ensure role helper exists before policy definitions in replay environments.
CREATE OR REPLACE FUNCTION public.user_has_role(role_name text)
RETURNS boolean AS $$
DECLARE
  has_role boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = role_name
  ) INTO has_role;

  RETURN has_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Therapist certifications are viewable by admin and assigned the" ON therapist_certifications;
DROP POLICY IF EXISTS "Therapist certifications can be deleted by admin and assigned t" ON therapist_certifications;
DROP POLICY IF EXISTS "Therapist certifications can be inserted by admin and assigned " ON therapist_certifications;
DROP POLICY IF EXISTS "Therapist certifications can be updated by admin and assigned t" ON therapist_certifications;

-- Add RLS policies
CREATE POLICY "Therapist certifications are viewable by admin and assigned the"
  ON therapist_certifications
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN public.user_has_role('admin'::text) THEN true
      WHEN public.user_has_role('therapist'::text) THEN therapist_id = auth.uid()
      ELSE false
    END
  );

CREATE POLICY "Therapist certifications can be deleted by admin and assigned t"
  ON therapist_certifications
  FOR DELETE
  TO authenticated
  USING (
    CASE
      WHEN public.user_has_role('admin'::text) THEN true
      WHEN public.user_has_role('therapist'::text) THEN therapist_id = auth.uid()
      ELSE false
    END
  );

CREATE POLICY "Therapist certifications can be inserted by admin and assigned "
  ON therapist_certifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN public.user_has_role('admin'::text) THEN true
      WHEN public.user_has_role('therapist'::text) THEN therapist_id = auth.uid()
      ELSE false
    END
  );

CREATE POLICY "Therapist certifications can be updated by admin and assigned t"
  ON therapist_certifications
  FOR UPDATE
  TO authenticated
  USING (
    CASE
      WHEN public.user_has_role('admin'::text) THEN true
      WHEN public.user_has_role('therapist'::text) THEN therapist_id = auth.uid()
      ELSE false
    END
  )
  WITH CHECK (
    CASE
      WHEN public.user_has_role('admin'::text) THEN true
      WHEN public.user_has_role('therapist'::text) THEN therapist_id = auth.uid()
      ELSE false
    END
  );

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_therapist_certifications_updated_at ON therapist_certifications;

-- Add updated_at trigger
CREATE TRIGGER update_therapist_certifications_updated_at
  BEFORE UPDATE ON therapist_certifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();